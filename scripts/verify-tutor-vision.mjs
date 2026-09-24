#!/usr/bin/env node
/**
 * 验证「拍图讲错题」的完整链路（容器内运行）。
 *
 * 覆盖的环节：multipart 上传 → MinIO 存储 → 按会话读回 → 转 data URL → 视觉模型 → 回答。
 * 之前只验证过"模型能读图"（直连探针），接口这几段是空的。
 *
 * 断言依据是图里已知的数字：模型必须念出 45 与 15，才算真的读到了图，
 * 而不是靠上下文猜。验证用的会话结束会归档，不留在家长界面上。
 *
 * 用法（容器内）：node /app/.verify/verify-tutor-vision.mjs /tmp/probe.png [childId]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createSseParser, summarizeRoundTrip } from "./lib/sse-parse.mjs";
import { pickConversationId } from "./lib/api-shapes.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4100";
const imagePath = process.argv[2];
const childIdArg = process.argv[3];
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET missing");
if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`找不到图片：${imagePath}`);

const prisma = new PrismaClient();

function signJwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const user = await prisma.user.findFirst({ where: { familyId: { not: null } }, orderBy: { createdAt: "asc" } });
if (!user) throw new Error("找不到带家庭的账号");
const child = childIdArg
  ? await prisma.child.findFirst({ where: { id: childIdArg, familyId: user.familyId } })
  : await prisma.child.findFirst({ where: { familyId: user.familyId }, orderBy: { createdAt: "asc" } });
if (!child) throw new Error("该家庭没有孩子");

const jwt = signJwt({ sub: user.id, familyId: user.familyId });
const authHeaders = { Authorization: `Bearer ${jwt}` };
const result = { child: child.name, steps: {}, errors: [], conversationId: null, cleaned: false };

// 1) 建会话（钉住这个孩子）
const created = await fetch(`${BASE}/api/tutor/conversations`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ child_id: child.id, title: "拍图链路自检" }),
});
if (!created.ok) throw new Error(`建会话失败 HTTP ${created.status}：${(await created.text()).slice(0, 200)}`);
result.conversationId = pickConversationId(await created.json());
if (!result.conversationId) throw new Error("建会话响应里没有会话 ID");
result.steps.created = true;

// 2) 上传图片
const bytes = fs.readFileSync(imagePath);
const form = new FormData();
form.append("file", new Blob([bytes], { type: "image/png" }), "homework.png");
const uploaded = await fetch(`${BASE}/api/tutor/conversations/${result.conversationId}/attachments`, {
  method: "POST",
  headers: authHeaders,
  body: form,
});
const uploadBody = await uploaded.json().catch(() => ({}));
if (!uploaded.ok) throw new Error(`上传失败 HTTP ${uploaded.status}：${JSON.stringify(uploadBody).slice(0, 200)}`);
result.steps.uploaded = { objectKey: uploadBody.objectKey, bytes: bytes.length };
if (!uploadBody.objectKey) throw new Error("上传响应里没有 objectKey");

// 3) 带着图片提问：要求它把题面念出来，便于用已知数字断言
const sent = await fetch(`${BASE}/api/tutor/conversations/${result.conversationId}/messages`, {
  method: "POST",
  headers: { ...authHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ text: "这道题我看不太懂，你先帮我把题目念一遍，告诉我题里的数字。", attachments: [uploadBody.objectKey] }),
});
if (!sent.ok || !sent.body) throw new Error(`发消息失败 HTTP ${sent.status}：${(await sent.text()).slice(0, 200)}`);

const parser = createSseParser();
const collected = [];
for await (const chunk of sent.body) collected.push(...parser.push(new TextDecoder().decode(chunk, { stream: true })));
collected.push(...parser.flush());
const summary = summarizeRoundTrip(collected);
result.steps.answer = summary;

// 4) 归档
const archived = await fetch(`${BASE}/api/tutor/conversations/${result.conversationId}`, {
  method: "DELETE",
  headers: authHeaders,
});
result.cleaned = archived.ok;

await prisma.$disconnect();

// ---- 判定 ----
const full = collected
  .filter((event) => event.event === "text")
  .map((event) => {
    try {
      return JSON.parse(event.data)?.delta ?? "";
    } catch {
      return "";
    }
  })
  .join("");

if (summary.errors.length) result.errors.push(...summary.errors);

const readNumbers = /45/.test(full) && /15/.test(full);
const pass = !summary.errors.length && summary.textLength > 0 && readNumbers;

console.log(JSON.stringify(result, null, 2));
console.log("");

if (summary.errors.length) {
  console.log(`❌ 链路出错：${summary.errors.join(" | ")}`);
} else if (!summary.textLength) {
  console.log("❌ 模型没有返回任何文字");
} else if (!readNumbers) {
  console.log(`❌ 回答里没有出现图上的数字（45 / 15），可能没真读到图。回答：${full.slice(0, 200)}`);
} else {
  console.log("✅ 拍图链路通：上传 → 存储 → 视觉模型读到了图里的 45 与 15");
  console.log(`   回答片段：${full.slice(0, 200)}`);
}

process.exitCode = pass ? 0 : 1;
