/**
 * 语音接口的线上/容器内验证（真走 HTTP 路由，真鉴权）。
 *
 * 与 npm run check:voice 的区别：那个直接打火山上游、验证凭据本身；
 * 这个打我们自己的 /api/tutor/voice/* ，验证"凭据 + 服务端装配 + 路由"整条路都通。
 *
 * 用法（容器内）：node /app/.verify/verify-voice-online.mjs
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4100";
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET missing");

const prisma = new PrismaClient();
const PROBE = "今天我们一起把这道题弄明白";

function signJwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const user = await prisma.user.findFirst({ where: { familyId: { not: null } }, orderBy: { createdAt: "asc" } });
if (!user) throw new Error("库里没有带家庭的账号，无法鉴权");
const auth = { Authorization: `Bearer ${signJwt({ sub: user.id, familyId: user.familyId })}` };

const result = { status: null, speak: null, transcribe: null, errors: [] };

// 1) 语音开关
const statusRes = await fetch(`${BASE}/api/tutor/voice/status`, { headers: auth });
result.status = { http: statusRes.status, body: await statusRes.json().catch(() => null) };
console.log(`语音开关 GET /api/tutor/voice/status -> ${statusRes.status} ${JSON.stringify(result.status.body)}`);

// 2) 合成：说一句话，拿到 mp3
const speakRes = await fetch(`${BASE}/api/tutor/voice/speak`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ text: PROBE }),
});
if (!speakRes.ok) {
  const text = (await speakRes.text()).slice(0, 300);
  result.errors.push(`合成失败 HTTP ${speakRes.status}：${text}`);
  console.log(`❌ 合成失败 HTTP ${speakRes.status}：${text}`);
} else {
  const audio = Buffer.from(await speakRes.arrayBuffer());
  result.speak = { http: speakRes.status, bytes: audio.length, contentType: speakRes.headers.get("content-type") };
  console.log(`✅ 合成 HTTP ${speakRes.status}，${audio.length} 字节，${speakRes.headers.get("content-type")}`);

  // 3) 识别：把刚合成的音频回灌，比对文字
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "probe.mp3");
  form.append("format", "mp3");
  const asrRes = await fetch(`${BASE}/api/tutor/voice/transcribe`, {
    method: "POST",
    headers: auth,
    body: form,
  });
  const asrBody = await asrRes.json().catch(() => null);
  const heard = String(asrBody?.text ?? "").trim();
  const normalize = (s) => s.replace(/[\s，。、！？,.!?]/g, "");
  const passed = normalize(heard) === normalize(PROBE);
  result.transcribe = { http: asrRes.status, heard, passed };
  console.log(`${passed ? "✅" : "⚠️"} 识别 HTTP ${asrRes.status}，读回「${heard}」`);
  if (!passed) result.errors.push(`识别结果与原文不一致：读回「${heard}」`);
}

await prisma.$disconnect();
console.log("");
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.errors.length ? 1 : 0;
