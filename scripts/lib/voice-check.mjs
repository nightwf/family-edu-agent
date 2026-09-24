/**
 * 语音自检的判定逻辑（纯函数，不联网，便于单测）。
 */

/**
 * 把火山语音的上游报错翻成能直接照做的动作。
 *
 * 火山语音有个坑：**业务错误常常是 HTTP 200 但响应体里带 code/message**
 * （鉴权、cluster、音色填错都属于这一类）。所以不能只看 HTTP 状态码。
 * 这里一律把上游原始 code/message 原样带出来，方便对着官方文档查；
 * 只在能明确判断时才给建议，不猜。
 */
export function humanizeVoiceError({ part, status, body }) {
  const raw = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const text = raw.slice(0, 300);
  const lower = text.toLowerCase();
  // 火山语音的错误码位置不固定：有的是顶层 code，有的藏在 header.code 里
  const code =
    body && typeof body === "object" ? (body.code ?? body.Code ?? body.header?.code ?? body.header?.Code) : undefined;
  const detail = code !== undefined ? `（上游 code=${code}，原文：${text}）` : `（HTTP ${status}，原文：${text}）`;

  const what = part === "tts" ? "语音合成" : "语音识别";

  if (lower.includes("appid") || lower.includes("app id")) {
    return `${what}失败：App ID 不对${detail}`;
  }
  // 先分辨是哪一套凭据，否则会把"API Key 填错"误导成"Access Token 填错"
  if (lower.includes("x-api-key") || lower.includes("invalid api key") || lower.includes("apikey")) {
    return `${what}失败：API Key 无效（去控制台「API Key 管理」重新复制；注意别和豆包方舟那把 ark- 开头的 Key 混）${detail}`;
  }
  if (status === 401 || status === 403 || lower.includes("token") || lower.includes("access key") || lower.includes("authentic") || lower.includes("unauthor")) {
    return `${what}失败：Access Token 不对或没权限（确认用的是「语音技术」应用的凭据，不是方舟 API Key）${detail}`;
  }
  if (lower.includes("cluster")) {
    return `${what}失败：cluster（资源标识）填错了，去开通的那个服务的文档页抄${detail}`;
  }
  if (lower.includes("voice_type") || lower.includes("voice type") || lower.includes("speaker")) {
    return `${what}失败：音色 ID（voice_type）不存在或没权限${detail}`;
  }
  if (lower.includes("not open") || lower.includes("not activated") || lower.includes("unopened") || lower.includes("未开通")) {
    return `${what}失败：这项服务没开通，去「语音技术」里开通${detail}`;
  }
  if (lower.includes("quota") || lower.includes("limit") || lower.includes("concurren")) {
    return `${what}失败：超出配额或并发限制${detail}`;
  }
  if (status >= 500) return `${what}失败：上游服务异常，稍后重试${detail}`;
  return `${what}失败${detail}`;
}

/** 去掉标点与空白，只比字。语音识别本来就会吞掉标点，不该因此判失败。 */
export function normalizeSpeech(text) {
  return String(text ?? "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/[０-９ａ-ｚＡ-Ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 字符级 Dice 相似度：0 表示完全不同，1 表示完全一致。 */
export function similarity(expected, actual) {
  const a = normalizeSpeech(expected);
  const b = normalizeSpeech(actual);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const counts = new Map();
  for (const ch of a) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let overlap = 0;
  for (const ch of b) {
    const left = counts.get(ch) ?? 0;
    if (left > 0) {
      overlap += 1;
      counts.set(ch, left - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

/**
 * 判定"合成一句 → 识别回来"这一圈是否可信。
 * 阈值 0.6 是下限而不是及格线：儿童语音的真实准确率要在真机实测里单独看，
 * 这里只回答"凭据、cluster、音色这条链路是否真的通了"。
 */
export function judgeRoundTrip(expected, actual, threshold = 0.6) {
  const score = similarity(expected, actual);
  return { score: Number(score.toFixed(3)), passed: score >= threshold, threshold };
}
