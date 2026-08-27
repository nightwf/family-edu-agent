import { env } from "./env.js";

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
