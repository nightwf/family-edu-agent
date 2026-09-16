import { env } from "./env.js";

let accessTokenCache: { token: string; expiresAt: number } | null = null;

export class WechatError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export async function exchangeWechatCode(code: string) {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) {
    throw new WechatError("微信登录未配置，请先设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET", 503);
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", env.WECHAT_APP_ID);
  url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  if (!response.ok) throw new WechatError("微信登录服务暂时不可用，请稍后重试", 502);
  const data = await response.json() as {
    openid?: string;
    session_key?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!data.openid) {
    throw new WechatError(`微信登录失败：${data.errmsg || `errcode ${data.errcode}`}`, 400);
  }
  return {
    openid: data.openid,
    unionid: data.unionid,
    sessionKey: data.session_key || "",
  };
}

async function getWechatAccessToken() {
  if (!env.WECHAT_APP_ID || !env.WECHAT_APP_SECRET) {
    throw new WechatError("微信小程序码未配置，请先设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET", 503);
  }
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) return accessTokenCache.token;

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", env.WECHAT_APP_ID);
  url.searchParams.set("secret", env.WECHAT_APP_SECRET);
  const response = await fetch(url);
  const data = await response.json() as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!response.ok || !data.access_token) {
    throw new WechatError(`获取微信小程序 access_token 失败：${data.errmsg || data.errcode || response.status}`, 502);
  }
  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in || 7200) - 120) * 1000,
  };
  return data.access_token;
}

export async function getMiniProgramCode(scene: string, page: string) {
  const accessToken = await getWechatAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene,
      page,
      check_path: false,
      env_version: env.WECHAT_QR_ENV_VERSION,
      width: 430,
    }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (response.ok && contentType.startsWith("image/")) {
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
  }
  const text = await response.text();
  let message = text;
  try {
    const data = JSON.parse(text) as { errmsg?: string; errcode?: number };
    message = data.errmsg || String(data.errcode || text);
  } catch (_error) {
    // Keep the response text for diagnostics.
  }
  throw new WechatError(`生成微信小程序码失败：${message}`, 502);
}
