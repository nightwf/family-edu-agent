#!/usr/bin/env node
/**
 * 验证上传链路的"体积上限"在每一层都放行（容器内运行）。
 *
 * 为什么需要它：作业照常见 2–4MB，而这条路上有三道各自独立的 1MB 卡口——
 *   Fastify 的 bodyLimit、@fastify/multipart 的 fileSize（默认跟随 bodyLimit）、
 *   nginx 的 client_max_body_size（默认 1m）。
 * 任何一道没放开，表现都是"上传失败"且响应体为空，看起来像网络问题。
 * 用本地地址跑只能覆盖前两道，用域名跑才会覆盖 nginx，所以两条都跑。
 *
 * 会往库里建一个自检会话并在结束时归档；上传的对象自检后立即删除。
 *
 * 用法（容器内）：
 *   node /app/.verify/verify-upload-limits.mjs                                   # 127.0.0.1:4100
 *   BASE=https://heyaagent.top/family-edu node /app/.verify/verify-upload-limits.mjs
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE || process.env.BASE_URL || "http://127.0.0.1:4100";
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET missing");

const prisma = new PrismaClient();
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const user = await prisma.user.findFirst({ where: { familyId: { not: null } }, orderBy: { createdAt: "asc" } });
if (!user) throw new Error("找不到带家庭的账号");
const child = await prisma.child.findFirst({ where: { familyId: user.familyId }, orderBy: { createdAt: "asc" } });
if (!child) throw new Error("该家庭没有孩子");

const head = encode({ alg: "HS256", typ: "JWT" });
const now = Math.floor(Date.now() / 1000);
const body = encode({ sub: user.id, familyId: user.familyId, iat: now, exp: now + 600 });
const jwt = `${head}.${body}.${crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
const auth = { Authorization: `Bearer ${jwt}` };

const result = { base: BASE, steps: {}, errors: [] };
console.log(`路径：${BASE}`);

const created = await fetch(`${BASE}/api/tutor/conversations`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ child_id: child.id, title: "上传上限自检" }),
});
if (!created.ok) throw new Error(`建会话失败 HTTP ${created.status}`);
const conversationId = (await created.json()).conversation.id;

// 1) 手机作业照的常见体积
const photo = Buffer.alloc(2_800_000, 3);
const photoForm = new FormData();
photoForm.append("file", new Blob([photo], { type: "image/jpeg" }), "photo.jpg");
const uploaded = await fetch(`${BASE}/api/tutor/conversations/${conversationId}/attachments`, {
  method: "POST",
  headers: auth,
  body: photoForm,
});
const uploadBody = await uploaded.json().catch(() => ({}));
result.steps["2.8MB 图片"] = { status: uploaded.status, stored: Boolean(uploadBody.objectKey) };
console.log(`  2.8MB 图片：HTTP ${uploaded.status}${uploadBody.objectKey ? "（已存储）" : `（${JSON.stringify(uploadBody).slice(0, 120)}）`}`);
if (!uploaded.ok) result.errors.push("2.8MB 图片被拒绝：这一层还有 1MB 卡口");

if (uploadBody.objectKey) {
  const { deleteFile } = await import("../apps/api/dist/storage.js");
  await deleteFile(uploadBody.objectKey.replace(/^s3:\/\/[^/]+\//, ""));
  result.cleaned = true;
  console.log("  自检图已清理");
}

// 2) 语音接口必须"收到文件"：未开通时返回 503，而不是 400 没有收到音频
const audioForm = new FormData();
audioForm.append("file", new Blob([Buffer.alloc(1024, 5)], { type: "audio/webm" }), "voice.webm");
const asr = await fetch(`${BASE}/api/tutor/voice/transcribe`, { method: "POST", headers: auth, body: audioForm });
const asrBody = await asr.json().catch(() => ({}));
result.steps["语音上传"] = { status: asr.status, error: asrBody.error };
console.log(`  语音上传：HTTP ${asr.status} ${JSON.stringify(asrBody).slice(0, 120)}`);
if (asr.status === 400) result.errors.push("语音接口没收到文件：multipart 取文件仍有问题");

await fetch(`${BASE}/api/tutor/conversations/${conversationId}`, { method: "DELETE", headers: auth });
await prisma.$disconnect();

console.log("");
console.log(JSON.stringify(result, null, 2));
if (result.errors.length) {
  console.log(`❌ ${result.errors.join(" | ")}`);
  process.exitCode = 1;
} else {
  console.log("✅ 体积上限已放行：上传能到业务层（语音 503 属未开通，符合预期）");
}
