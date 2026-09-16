import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { exchangeWechatCode, getMiniProgramCode, WechatError } from "./wechat.js";
import { getActiveFamilyMember } from "./family-members.js";
import { findOrCreateWechatUser } from "./family-onboarding.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_TTL_MS = 10 * 60 * 1000;
const encryptionKey = crypto.createHash("sha256").update(env.JWT_SECRET).digest();

type AuthContext = { id: string; familyId: string | null };
type OAuthRouteOptions = {
  requireUserAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  getUserAuth: (request: FastifyRequest) => AuthContext | null;
  createWechatSessionResponse: (user: any, familyId: string | null) => Promise<any>;
};

export function hashOpaque(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEquals(left: string, right: string) {
  const a = Buffer.from(hashOpaque(left));
  const b = Buffer.from(hashOpaque(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomOpaque(prefix: string, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
}

function encryptValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptValue(payload: string) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export function verifyPkceS256(verifier: string, challenge: string) {
  if (!verifier || !challenge) return false;
  const actual = crypto.createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(challenge);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isAllowedWorkbuddyRedirectUri(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "workbuddy:" && url.hostname === "workbuddy") {
      return decodeURIComponent(url.pathname) === `/mcp/connector:${env.WORKBUDDY_SOURCE}/oauth/callback`;
    }
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname)
      && url.pathname === "/oauth/callback";
  } catch (_error) {
    return false;
  }
}

function oauthError(reply: FastifyReply, statusCode: number, error: string, description: string) {
  return reply.code(statusCode).send({ error, error_description: description });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function authorizePage(input: { publicId: string; browserSecret: string; clientName: string; expiresAt: Date }) {
  const statusUrl = `${env.PUBLIC_BASE_URL}/api/oauth/bindings/${input.publicId}/status?browser_secret=${encodeURIComponent(input.browserSecret)}`;
  const qrUrl = `${env.PUBLIC_BASE_URL}/api/oauth/bindings/${input.publicId}/qrcode?browser_secret=${encodeURIComponent(input.browserSecret)}`;
  const expiresText = input.expiresAt.toLocaleString("zh-CN", { hour12: false });
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>连接禾芽家庭教务</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f7f1df;color:#19343b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;display:grid;place-items:center;padding:24px}
.panel{width:min(520px,100%);background:#fffdf7;border:1px solid #e5dcc4;border-radius:16px;padding:32px;box-shadow:0 20px 60px rgba(30,80,72,.12)}
.brand{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700}
.mark{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:#f6ca60;color:#17464b;font-size:24px}
.eyebrow{margin-top:28px;color:#0f766e;font-size:13px;font-weight:700}
.title{font-size:28px;line-height:1.35;margin:8px 0}.desc{color:#6e7f81;line-height:1.8;margin:0}
.qr{width:232px;height:232px;margin:26px auto 18px;border:10px solid #fff;background:#fff;display:block;object-fit:contain}
.status{border-top:1px solid #eee4cf;padding-top:18px;text-align:center;color:#476469}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f0b83d;margin-right:8px}
.ok .dot{background:#14a47b}.error{color:#c64b38;font-weight:600}
.meta{text-align:center;color:#98a2a3;font-size:12px;margin-top:14px}
</style></head>
<body><main class="panel">
<div class="brand"><span class="mark">禾</span><span>禾芽家庭教务</span></div>
<div class="eyebrow">WORKBUDDY 安全连接</div>
<h1 class="title">微信扫码，选择要连接的家庭</h1>
<p class="desc">扫码进入禾芽小程序，确认家庭和授权范围。二维码不包含家庭资料或长期 Token。</p>
<img class="qr" src="${escapeHtml(qrUrl)}" alt="禾芽小程序码">
<div id="status" class="status"><span class="dot"></span><span>等待小程序确认</span></div>
<div class="meta">正在连接 ${escapeHtml(input.clientName)} · ${escapeHtml(expiresText)} 前有效</div>
</main>
<script>
const statusUrl=${JSON.stringify(statusUrl)};
const box=document.getElementById('status');
let stopped=false;
async function poll(){
  if(stopped)return;
  try{
    const response=await fetch(statusUrl,{cache:'no-store'});
    const data=await response.json();
    if(data.status==='approved'&&data.redirect_url){
      stopped=true;box.className='status ok';
      box.innerHTML='<span class="dot"></span><span>授权成功，正在返回 WorkBuddy</span>';
      setTimeout(()=>location.assign(data.redirect_url),500);return;
    }
    if(data.status==='expired'||data.status==='denied'){
      stopped=true;box.className='status error';
      box.textContent=data.status==='expired'?'二维码已过期，请返回 WorkBuddy 重新连接':'本次授权已取消';return;
    }
  }catch(e){}
  setTimeout(poll,2000);
}
poll();
</script></body></html>`;
}

async function findValidBinding(publicId: string) {
  const binding = await prisma.oAuthBindingSession.findUnique({
    where: { publicId },
    include: { oauthClient: true },
  });
  if (!binding) return null;
  if (binding.expiresAt.getTime() <= Date.now() && binding.status === "pending") {
    return prisma.oAuthBindingSession.update({
      where: { id: binding.id },
      data: { status: "expired" },
      include: { oauthClient: true },
    });
  }
  return binding;
}

async function findValidWebLogin(publicId: string) {
  const session = await prisma.wechatWebLoginSession.findUnique({ where: { publicId } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now() && session.status === "pending") {
    return prisma.wechatWebLoginSession.update({ where: { id: session.id }, data: { status: "expired" } });
  }
  return session;
}

async function issueTokens(input: { oauthClientId: string; familyId: string; userId: string; scope: string }) {
  const accessToken = randomOpaque("heya_at_");
  const refreshToken = randomOpaque("heya_rt_");
  const now = Date.now();
  await prisma.oAuthAccessToken.create({
    data: {
      oauthClientId: input.oauthClientId,
      familyId: input.familyId,
      userId: input.userId,
      scope: input.scope,
      accessTokenHash: hashOpaque(accessToken),
      refreshTokenHash: hashOpaque(refreshToken),
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return { accessToken, refreshToken };
}

export async function resolveFamilyByOAuthAccessToken(rawToken: string) {
  if (!rawToken) return null;
  const token = await prisma.oAuthAccessToken.findUnique({ where: { accessTokenHash: hashOpaque(rawToken) } });
  if (!token || token.status !== "active" || token.revokedAt || token.expiresAt.getTime() <= Date.now()) return null;
  const [member, user] = await Promise.all([
    getActiveFamilyMember(token.familyId, token.userId),
    prisma.user.findUnique({ where: { id: token.userId }, select: { status: true } }),
  ]);
  if (!member || !user || user.status !== "active") return null;
  await prisma.oAuthAccessToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return token.familyId;
}

export async function listOAuthConnections(familyId: string) {
  return prisma.oAuthAccessToken.findMany({
    where: { familyId, status: "active", revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    include: {
      oauthClient: { select: { clientId: true, clientName: true } },
      user: { select: { id: true, email: true, wechatNickname: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeOAuthConnection(familyId: string, connectionId: string) {
  const result = await prisma.oAuthAccessToken.updateMany({
    where: { id: connectionId, familyId, status: "active" },
    data: { status: "revoked", revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions) {
  const protectedResourceMetadata = () => ({
    resource: `${env.PUBLIC_BASE_URL}/mcp`,
    authorization_servers: [env.PUBLIC_BASE_URL],
    scopes_supported: ["family.read", "family.write"],
  });
  const authorizationServerMetadata = () => ({
    issuer: env.PUBLIC_BASE_URL,
    authorization_endpoint: `${env.PUBLIC_BASE_URL}/oauth/authorize`,
    token_endpoint: `${env.PUBLIC_BASE_URL}/oauth/token`,
    registration_endpoint: `${env.PUBLIC_BASE_URL}/oauth/register`,
    revocation_endpoint: `${env.PUBLIC_BASE_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["family.read", "family.write", "offline_access"],
  });

  // RFC 9728 / RFC 8414 allow both the bare and resource-suffixed well-known paths.
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource/family-edu/mcp",
  ]) {
    app.get(path, async () => protectedResourceMetadata());
  }
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/mcp",
    "/.well-known/oauth-authorization-server/family-edu/mcp",
  ]) {
    app.get(path, async () => authorizationServerMetadata());
  }

  app.post("/oauth/register", async (request, reply) => {
    const body = request.body as any;
    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!redirectUris.length || redirectUris.some((uri: string) => !isAllowedWorkbuddyRedirectUri(uri))) {
      return oauthError(reply, 400, "invalid_redirect_uri", "仅允许 WorkBuddy 专用回调或本机回环地址");
    }
    if (body?.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
      return oauthError(reply, 400, "invalid_client_metadata", "禾芽只接受无需 client_secret 的公共客户端");
    }
    const client = await prisma.oAuthClient.create({
      data: {
        clientId: randomOpaque("heya_client_", 18),
        clientName: String(body?.client_name || "WorkBuddy"),
        redirectUris,
        grantTypes: Array.isArray(body?.grant_types) ? body.grant_types.map(String) : ["authorization_code", "refresh_token"],
        responseTypes: Array.isArray(body?.response_types) ? body.response_types.map(String) : ["code"],
        tokenEndpointAuthMethod: "none",
      },
    });
    return reply.code(201).send({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: "none",
    });
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const query = request.query as any;
    const client = await prisma.oAuthClient.findUnique({ where: { clientId: String(query.client_id || "") } });
    if (!client || client.status !== "active") return oauthError(reply, 400, "invalid_client", "客户端未注册或已停用");
    const redirectUri = String(query.redirect_uri || "");
    if (!client.redirectUris.includes(redirectUri)) return oauthError(reply, 400, "invalid_request", "redirect_uri 与注册信息不一致");
    if (query.response_type !== "code") return oauthError(reply, 400, "unsupported_response_type", "仅支持 authorization code");
    if (!query.code_challenge || query.code_challenge_method !== "S256") {
      return oauthError(reply, 400, "invalid_request", "必须使用 PKCE S256");
    }
    const publicId = crypto.randomBytes(18).toString("base64url");
    const browserSecret = randomOpaque("browser_", 24);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.oAuthBindingSession.create({
      data: {
        publicId,
        browserSecretHash: hashOpaque(browserSecret),
        oauthClientId: client.id,
        redirectUri,
        state: query.state ? String(query.state) : null,
        scope: String(query.scope || "family.read family.write"),
        codeChallenge: String(query.code_challenge),
        codeChallengeMethod: "S256",
        expiresAt,
      },
    });
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(authorizePage({
      publicId,
      browserSecret,
      clientName: client.clientName || "WorkBuddy",
      expiresAt,
    }));
  });

  app.post("/oauth/token", async (request, reply) => {
    const body = request.body as any;
    const grantType = String(body?.grant_type || "");
    const client = await prisma.oAuthClient.findUnique({ where: { clientId: String(body?.client_id || "") } });
    if (!client || client.status !== "active") return oauthError(reply, 401, "invalid_client", "客户端无效");
    reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");

    if (grantType === "authorization_code") {
      const authorizationCode = await prisma.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashOpaque(String(body?.code || "")) } });
      if (!authorizationCode || authorizationCode.oauthClientId !== client.id || authorizationCode.usedAt
        || authorizationCode.expiresAt.getTime() <= Date.now()) {
        return oauthError(reply, 400, "invalid_grant", "授权码无效、已使用或已过期");
      }
      if (authorizationCode.redirectUri !== String(body?.redirect_uri || "")) {
        return oauthError(reply, 400, "invalid_grant", "redirect_uri 不匹配");
      }
      if (!verifyPkceS256(String(body?.code_verifier || ""), authorizationCode.codeChallenge)) {
        return oauthError(reply, 400, "invalid_grant", "PKCE 校验失败");
      }
      const claimed = await prisma.oAuthAuthorizationCode.updateMany({
        where: { id: authorizationCode.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return oauthError(reply, 400, "invalid_grant", "授权码已经使用");
      const tokens = await issueTokens({
        oauthClientId: client.id,
        familyId: authorizationCode.familyId,
        userId: authorizationCode.userId,
        scope: authorizationCode.scope,
      });
      return {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: tokens.refreshToken,
        scope: authorizationCode.scope,
      };
    }

    if (grantType === "refresh_token") {
      const rawRefreshToken = String(body?.refresh_token || "");
      const token = await prisma.oAuthAccessToken.findUnique({ where: { refreshTokenHash: hashOpaque(rawRefreshToken) } });
      if (!token || token.oauthClientId !== client.id || token.status !== "active" || token.revokedAt
        || !token.refreshExpiresAt || token.refreshExpiresAt.getTime() <= Date.now()) {
        return oauthError(reply, 400, "invalid_grant", "refresh_token 无效或已过期");
      }
      const accessToken = randomOpaque("heya_at_");
      await prisma.oAuthAccessToken.update({
        where: { id: token.id },
        data: { accessTokenHash: hashOpaque(accessToken), expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000) },
      });
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: rawRefreshToken,
        scope: token.scope,
      };
    }
    return oauthError(reply, 400, "unsupported_grant_type", "仅支持 authorization_code 和 refresh_token");
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const rawToken = String((request.body as any)?.token || "");
    if (rawToken) {
      await prisma.oAuthAccessToken.updateMany({
        where: { OR: [{ accessTokenHash: hashOpaque(rawToken) }, { refreshTokenHash: hashOpaque(rawToken) }] },
        data: { status: "revoked", revokedAt: new Date() },
      });
    }
    return reply.code(200).send({ ok: true });
  });

  /* WorkBuddy binding flow */

  app.get("/api/oauth/bindings/:publicId/qrcode", async (request, reply) => {
    const { publicId } = request.params as any;
    const { browser_secret: browserSecret } = request.query as any;
    const binding = await findValidBinding(String(publicId));
    if (!binding || hashOpaque(String(browserSecret || "")) !== binding.browserSecretHash) {
      return reply.code(404).send({ error: "授权会话不存在" });
    }
    if (binding.status !== "pending") return reply.code(410).send({ error: "授权会话已结束" });
    try {
      const image = await getMiniProgramCode(binding.publicId, "pages/workbuddy-bind/workbuddy-bind");
      return reply.type(image.contentType).header("Cache-Control", "no-store").send(image.buffer);
    } catch (error) {
      if (error instanceof WechatError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get("/api/oauth/bindings/:publicId/status", async (request, reply) => {
    const { publicId } = request.params as any;
    const { browser_secret: browserSecret } = request.query as any;
    const binding = await findValidBinding(String(publicId));
    if (!binding || hashOpaque(String(browserSecret || "")) !== binding.browserSecretHash) {
      return reply.code(404).send({ error: "授权会话不存在" });
    }
    if (binding.status === "approved" && binding.authorizationCodeCipher) {
      const callback = new URL(binding.redirectUri);
      callback.searchParams.set("code", decryptValue(binding.authorizationCodeCipher));
      if (binding.state) callback.searchParams.set("state", binding.state);
      return { status: binding.status, redirect_url: callback.toString() };
    }
    return { status: binding.status, expires_at: binding.expiresAt.toISOString() };
  });

  app.post("/api/oauth/bindings/:publicId/wechat-session", async (request, reply) => {
    const { publicId } = request.params as any;
    const binding = await findValidBinding(String(publicId));
    if (!binding || binding.status !== "pending") return reply.code(410).send({ error: "扫码授权已过期，请返回 WorkBuddy 重试" });
    try {
      const { code } = request.body as any;
      if (!code) return reply.code(400).send({ error: "缺少微信登录 code" });
      const wechat = await exchangeWechatCode(String(code));
      const user = await findOrCreateWechatUser(wechat.openid, wechat.unionid);
      const session = await options.createWechatSessionResponse(user, user.familyId);
      const memberships = await prisma.familyMember.findMany({
        where: { userId: user.id, status: "active" },
        include: { family: { select: { id: true, name: true } } },
        orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
      });
      return {
        ...session,
        memberships,
        binding: { client_name: binding.oauthClient.clientName || "WorkBuddy", expires_at: binding.expiresAt.toISOString() },
      };
    } catch (error) {
      if (error instanceof WechatError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.post("/api/oauth/bindings/:publicId/approve", { preHandler: options.requireUserAuth as any }, async (request, reply) => {
    const { publicId } = request.params as any;
    const auth = options.getUserAuth(request);
    if (!auth) return reply.code(401).send({ error: "未登录或登录已过期" });
    const familyId = String((request.body as any)?.familyId || "").trim();
    const binding = await findValidBinding(String(publicId));
    if (!binding || binding.status !== "pending") return reply.code(410).send({ error: "扫码授权已过期，请返回 WorkBuddy 重试" });
    const member = await getActiveFamilyMember(familyId, auth.id);
    if (!member) return reply.code(403).send({ error: "你不是所选家庭的管理者" });

    const rawCode = randomOpaque("heya_code_");
    await prisma.$transaction(async (tx) => {
      await tx.oAuthAuthorizationCode.create({
        data: {
          codeHash: hashOpaque(rawCode),
          oauthClientId: binding.oauthClientId,
          familyId,
          userId: auth.id,
          redirectUri: binding.redirectUri,
          scope: binding.scope,
          codeChallenge: binding.codeChallenge,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      await tx.oAuthBindingSession.update({
        where: { id: binding.id },
        data: { familyId, userId: auth.id, authorizationCodeCipher: encryptValue(rawCode), status: "approved", approvedAt: new Date() },
      });
    });
    return { ok: true, family_id: familyId, client_name: binding.oauthClient.clientName || "WorkBuddy" };
  });

  /* Web WeChat QR login flow */

  app.post("/api/auth/wechat/web/session", async () => {
    const publicId = crypto.randomBytes(18).toString("base64url");
    const browserSecret = randomOpaque("browser_", 24);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.wechatWebLoginSession.create({
      data: { publicId, browserSecretHash: hashOpaque(browserSecret), expiresAt },
    });
    return {
      public_id: publicId,
      browser_secret: browserSecret,
      expires_at: expiresAt.toISOString(),
      qr_url: `${env.PUBLIC_BASE_URL}/api/auth/wechat/web/${publicId}/qrcode?browser_secret=${encodeURIComponent(browserSecret)}`,
    };
  });

  app.get("/api/auth/wechat/web/:publicId/qrcode", async (request, reply) => {
    const { publicId } = request.params as any;
    const { browser_secret: browserSecret } = request.query as any;
    const session = await findValidWebLogin(String(publicId));
    if (!session || hashOpaque(String(browserSecret || "")) !== session.browserSecretHash) {
      return reply.code(404).send({ error: "登录会话不存在" });
    }
    if (session.status !== "pending") return reply.code(410).send({ error: "登录会话已结束" });
    try {
      const image = await getMiniProgramCode(session.publicId, "pages/web-login/web-login");
      return reply.type(image.contentType).header("Cache-Control", "no-store").send(image.buffer);
    } catch (error) {
      if (error instanceof WechatError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get("/api/auth/wechat/web/:publicId/status", async (request, reply) => {
    const { publicId } = request.params as any;
    const { browser_secret: browserSecret } = request.query as any;
    const session = await findValidWebLogin(String(publicId));
    if (!session || hashOpaque(String(browserSecret || "")) !== session.browserSecretHash) {
      return reply.code(404).send({ error: "登录会话不存在" });
    }
    return {
      status: session.status,
      login_code: session.status === "approved" && session.loginCodeCipher ? decryptValue(session.loginCodeCipher) : undefined,
      expires_at: session.expiresAt.toISOString(),
    };
  });

  app.post("/api/auth/wechat/web/:publicId/wechat-session", async (request, reply) => {
    const { publicId } = request.params as any;
    const session = await findValidWebLogin(String(publicId));
    if (!session || session.status !== "pending") return reply.code(410).send({ error: "扫码登录已过期，请刷新网页重试" });
    try {
      const { code } = request.body as any;
      if (!code) return reply.code(400).send({ error: "缺少微信登录 code" });
      const wechat = await exchangeWechatCode(String(code));
      const user = await findOrCreateWechatUser(wechat.openid, wechat.unionid);
      const appSession = await options.createWechatSessionResponse(user, user.familyId);
      const memberships = await prisma.familyMember.findMany({
        where: { userId: user.id, status: "active" },
        include: { family: { select: { id: true, name: true } } },
        orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
      });
      return { ...appSession, memberships, target: "web" };
    } catch (error) {
      if (error instanceof WechatError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.post("/api/auth/wechat/web/:publicId/approve", { preHandler: options.requireUserAuth as any }, async (request, reply) => {
    const { publicId } = request.params as any;
    const auth = options.getUserAuth(request);
    if (!auth) return reply.code(401).send({ error: "未登录或登录已过期" });
    const session = await findValidWebLogin(String(publicId));
    if (!session || session.status !== "pending") return reply.code(410).send({ error: "扫码登录已过期，请刷新网页重试" });
    const familyId = String((request.body as any)?.familyId || auth.familyId || "").trim();
    const member = familyId ? await getActiveFamilyMember(familyId, auth.id) : null;
    if (!member) return reply.code(403).send({ error: "请先在微信里选择或创建一个家庭" });
    const loginCode = randomOpaque("heya_login_", 24);
    await prisma.$transaction([
      prisma.user.update({ where: { id: auth.id }, data: { familyId } }),
      prisma.wechatWebLoginSession.update({
        where: { id: session.id },
        data: { userId: auth.id, familyId, loginCodeCipher: encryptValue(loginCode), status: "approved", approvedAt: new Date() },
      }),
    ]);
    return { ok: true, family_id: familyId };
  });

  app.post("/api/auth/wechat/web/exchange", async (request, reply) => {
    const body = request.body as any;
    const session = await findValidWebLogin(String(body?.public_id || ""));
    if (!session || session.status !== "approved" || session.consumedAt || !session.userId || !session.loginCodeCipher) {
      return reply.code(400).send({ error: "登录授权无效或已经使用" });
    }
    if (hashOpaque(String(body?.browser_secret || "")) !== session.browserSecretHash) {
      return reply.code(403).send({ error: "浏览器登录凭证无效" });
    }
    if (!safeEquals(String(body?.login_code || ""), decryptValue(session.loginCodeCipher))) {
      return reply.code(400).send({ error: "登录授权码无效" });
    }
    const claimed = await prisma.wechatWebLoginSession.updateMany({
      where: { id: session.id, consumedAt: null, status: "approved" },
      data: { consumedAt: new Date(), status: "consumed" },
    });
    if (claimed.count !== 1) return reply.code(400).send({ error: "登录授权已经使用" });
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== "active") return reply.code(403).send({ error: "账号不可用" });
    if (session.familyId && user.familyId !== session.familyId) {
      await prisma.user.update({ where: { id: user.id }, data: { familyId: session.familyId } });
    }
    return options.createWechatSessionResponse(user, session.familyId || user.familyId);
  });
}
