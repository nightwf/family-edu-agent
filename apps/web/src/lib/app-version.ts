/**
 * 网页版的"发现新版本"。
 *
 * 安卓 App 是 WebView 承载线上站点，它不会像浏览器那样隔三差五自己重载，
 * 孩子把 App 一直挂在后台再切回来，跑的还是几天前那一版代码。
 * 这里让页面自己去问服务器"现在发的是哪一版"，对不上就提示一句，
 * 点一下就换到新版——不用清缓存、不用重装 App。
 */

/** 这一版网页的版本号，构建时写进 index.html 的 <meta>。 */
export function currentAppVersion() {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content?.trim() || "";
}

/**
 * 服务器现在发的是哪一版。
 *
 * 拿不到一律返回空字符串，调用方按"不知道"处理、什么都不提示：
 * 离线、接口抽风这类情况不该在界面上多出一句吓人的话。
 * 带时间戳是为了绕过中间任何一层缓存——问的就是"现在"，不是"上次"。
 */
export async function fetchServerVersion(baseUrl: string, signal?: AbortSignal) {
  const response = await fetch(`${baseUrl}version.json?t=${Date.now()}`, { cache: "no-store", signal });
  if (!response.ok) return "";
  const data = await response.json().catch(() => null);
  return typeof data?.version === "string" ? data.version.trim() : "";
}

/**
 * 换到新版。
 *
 * 带一个查询参数重载：WebView 里那份旧的 index.html 有可能还在缓存里，
 * 换个 URL 就绕过去了，同时也能让新页面照常走它自己的加载流程。
 */
export function switchToLatestVersion(version: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("v", version || String(Date.now()));
  window.location.replace(url.toString());
}
