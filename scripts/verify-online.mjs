/**
 * 线上/容器内一次性验证脚本（仅排查用，不进构建产物）。
 * 用法（容器内）：node /tmp/verify-online.mjs
 *                node /tmp/verify-online.mjs --roundtrip   # 额外真发一轮对话（会写入并归档一条会话）
 * 依据 JWT_SECRET 解密最新 MCP token，走进程内端口验 MCP；再自签 JWT 验 /api/tutor/*。
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSseParser, summarizeRoundTrip } from "./lib/sse-parse.mjs";
import { pickConversationId, pickList } from "./lib/api-shapes.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4100";
const ROUNDTRIP = process.argv.includes("--roundtrip");
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET missing");

const prisma = new PrismaClient();
const key = crypto.createHash("sha256").update(secret).digest();

function decryptToken(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function signJwt(payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const out = { mcp: {}, tutor: {} };

// ---- MCP ----
const tokenRow = await prisma.mcpToken.findFirst({
  where: { status: "active", tokenCipher: { not: null } },
  orderBy: { createdAt: "desc" },
});
if (!tokenRow) {
  out.mcp.error = "no active mcp token";
} else {
  const raw = decryptToken(tokenRow.tokenCipher);
  const client = new Client({ name: "verify-online", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { "X-MCP-Token": raw } },
  });
  await client.connect(transport);
  const listed = await client.listTools();
  out.mcp.toolCount = listed.tools.length;
  out.mcp.hasSubjectOverview = listed.tools.some((t) => t.name === "get_subject_overview");

  const spec = await client.callTool({ name: "get_sync_spec", arguments: {} });
  const specText = spec?.content?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(specText);
    out.mcp.syncSpecVersion = parsed.version ?? parsed.syncSpecVersion ?? null;
  } catch {
    out.mcp.syncSpecVersion = "unparsed";
  }

  const children = await client.callTool({ name: "list_children", arguments: {} });
  const childText = children?.content?.[0]?.text ?? "[]";
  try {
    const parsed = JSON.parse(childText);
    const list = Array.isArray(parsed) ? parsed : parsed.children ?? parsed.items ?? [];
    out.mcp.childCount = list.length;
    out.mcp.childNames = list.slice(0, 5).map((c) => c?.name ?? c?.nickname ?? "?");
  } catch {
    out.mcp.childCount = "unparsed";
  }
  await client.close();
}

// ---- Tutor ----
/**
 * 真发一轮对话，把 SSE 事件收齐。
 * 这是唯一能证明"模型真的在回答、工具真的被调用"的检查，其余都是接口层探活。
 */
async function roundTrip(jwt, childId) {
  const auth = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  const collected = [];
  const result = { events: {}, textLength: 0, preview: "", toolCalls: [], errors: [], conversationId: null, cleaned: false };

  const created = await fetch(`${BASE}/api/tutor/conversations`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ child_id: childId ?? undefined, title: "线上连接自检" }),
  });
  if (!created.ok) {
    result.errors.push(`建会话失败 HTTP ${created.status}：${(await created.text()).slice(0, 200)}`);
    return result;
  }
  const conversation = await created.json();
  result.conversationId = pickConversationId(conversation);
  if (!result.conversationId) {
    // 显式报错：不要拿着 undefined 继续发消息，那样只会看到"会话不存在"这种误导性错误
    result.errors.push(`建会话响应里没找到会话 ID：${JSON.stringify(conversation).slice(0, 160)}`);
    return result;
  }

  const response = await fetch(`${BASE}/api/tutor/conversations/${result.conversationId}/messages`, {
    method: "POST",
    headers: auth,
    // 只问一句不需要工具也能答的话，避免验证动作被工具失败拖住
    body: JSON.stringify({ text: "用一句话说明你看到了我的哪些学习记录。", stream: true }),
  });

  if (!response.ok || !response.body) {
    result.errors.push(`发消息失败 HTTP ${response.status}：${(await response.text()).slice(0, 200)}`);
    await archive(jwt, result.conversationId, result);
    return result;
  }

  const parser = createSseParser();
  for await (const chunk of response.body) {
    collected.push(...parser.push(new TextDecoder().decode(chunk, { stream: true })));
  }
  collected.push(...parser.flush());

  Object.assign(result, summarizeRoundTrip(collected));
  await archive(jwt, result.conversationId, result);
  return result;
}

/** 验证用的会话不留在家长界面上。接口只支持归档，这里就照接口的能力做。 */
async function archive(jwt, conversationId, result) {
  try {
    const response = await fetch(`${BASE}/api/tutor/conversations/${conversationId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
    result.cleaned = response.ok;
    if (!response.ok) result.errors.push(`归档会话失败 HTTP ${response.status}`);
  } catch (error) {
    result.errors.push(`归档会话异常：${error?.message || error}`);
  }
}

const user = await prisma.user.findFirst({ where: { familyId: { not: null } }, orderBy: { createdAt: "asc" } });
if (!user) {
  out.tutor.error = "no user with family";
} else {
  const jwt = signJwt({ sub: user.id, familyId: user.familyId });
  for (const path of ["/api/tutor/status", "/api/tutor/quota", "/api/tutor/conversations"]) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
    let body = await res.text();
    if (body.length > 200) body = `${body.slice(0, 200)}...`;
    out.tutor[path] = { status: res.status, body };
  }

  if (ROUNDTRIP) {
    // 没配模型时一定跑不通，就不往家长的真实数据里写测试会话了
    const statusBody = out.tutor["/api/tutor/status"]?.body || "";
    const ready = /"ready"\s*:\s*true/.test(statusBody);
    const child = await prisma.child.findFirst({ where: { familyId: user.familyId }, orderBy: { createdAt: "asc" } });
    out.tutor.child = child ? { id: child.id, name: child.name } : null;

    if (!ready) {
      out.tutor.roundTrip = { skipped: "私教未就绪（TUTOR_ENABLED 关闭或未配模型），已跳过真实对话，不写测试数据" };
    } else if (!child) {
      out.tutor.roundTrip = { skipped: "该家庭还没有孩子，无法验证对话" };
    } else {
      out.tutor.roundTrip = await roundTrip(jwt, child.id);
    }
  }
}

await prisma.$disconnect();
console.log(JSON.stringify(out, null, 2));
