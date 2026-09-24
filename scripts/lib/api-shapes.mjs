/**
 * 接口返回结构的解析。
 *
 * 抽出来是因为踩过一次：`POST /api/tutor/conversations` 返回的是
 * `{ conversation: { id } }`，脚本按 `{ id }` 取，得到 undefined，
 * 接着往 `/conversations/undefined/messages` 发消息，报"会话不存在"——
 * 看起来像服务端故障，实际是脚本读错了字段。
 *
 * 这类结构一旦后端调整，验证脚本会静默失效，所以用兼容 + 显式报错的方式写。
 */

/** 从建会话的响应里取出会话 ID。取不到返回空串，由调用方决定如何报错。 */
export function pickConversationId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const nested = payload.conversation;
  if (nested && typeof nested === "object" && typeof nested.id === "string") return nested.id;
  if (typeof payload.id === "string") return payload.id;
  if (typeof payload.conversationId === "string") return payload.conversationId;
  return "";
}

/** 从列表响应里取出数组，兼容裸数组与包一层 `{ conversations }`。 */
export function pickList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}
