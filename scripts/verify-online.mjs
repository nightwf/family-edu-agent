/**
 * 线上/容器内一次性验证脚本（仅排查用，不进构建产物）。
 * 用法（容器内）：node /tmp/verify-online.mjs
 * 依据 JWT_SECRET 解密最新 MCP token，走进程内端口验 MCP；再自签 JWT 验 /api/tutor/*。
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE_URL || "http://127.0.0.1:4100";
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
}

await prisma.$disconnect();
console.log(JSON.stringify(out, null, 2));
