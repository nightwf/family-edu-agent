/**
 * 私教前端：入口可见性判定 + SSE 流式客户端。
 *
 * 入口本期只在安卓 APK 端出现。APK 是 WebView 承载线上站点，
 * MainActivity 会给 UA 附加 HeYaAndroid/1.0，所以这里按 UA 判定即可，
 * 不需要为私教重新打包。
 *
 * 注意：UA 是产品开关，不是安全边界。UA 可伪造，所以数据安全靠账号与
 * 会话身份，不靠这个判定。
 */

const APK_UA_MARK = "HeYaAndroid";
const DEBUG_KEY = "heyaTutorEntryDebug";

export function isApkClient(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return userAgent.includes(APK_UA_MARK);
}

/**
 * 是否显示私教入口。
 * 调试开关：地址带 ?tutor=1 或本地存了 heyaTutorEntryDebug=1 时也显示，
 * 方便在桌面浏览器里验证，不影响真实用户的界面。
 */
export function isTutorEntryVisible(href = typeof window === "undefined" ? "" : window.location.href) {
  if (isApkClient()) return true;
  try {
    const url = new URL(href);
    if (url.searchParams.get("tutor") === "1") {
      localStorage.setItem(DEBUG_KEY, "1");
      return true;
    }
    if (url.searchParams.get("tutor") === "0") {
      localStorage.removeItem(DEBUG_KEY);
      return false;
    }
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export type TutorStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; ok: boolean }
  | { type: "replace"; reason: string }
  | { type: "done"; messageId: string; quotaLeft: number; usage: { promptTokens: number; completionTokens: number } }
  | { type: "error"; message: string; retryable: boolean; detail?: string };

/**
 * 发一条消息并按 SSE 逐事件回调。
 * 用 fetch + ReadableStream 而不是 EventSource：需要带 Authorization 头，且是 POST。
 */
export async function streamTutorMessage(options: {
  apiBase: string;
  token: string;
  conversationId: string;
  text: string;
  attachments?: string[];
  signal?: AbortSignal;
  onEvent: (event: TutorStreamEvent) => void;
}) {
  const response = await fetch(`${options.apiBase}/api/tutor/conversations/${options.conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: JSON.stringify({ text: options.text, attachments: options.attachments || [] }),
    signal: options.signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error("服务端没有返回内容");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      let eventName = "";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!eventName || !dataLines.length) continue;
      try {
        options.onEvent({ type: eventName, ...JSON.parse(dataLines.join("\n")) } as TutorStreamEvent);
      } catch {
        // 单个事件解析失败不中断整条流
      }
    }
  }
}

/** 把回答按空行切成段落，便于渲染成有层次的讲解。 */
export function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}
