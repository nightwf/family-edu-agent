import { env } from "../../env.js";
import { createDoubaoProvider } from "./doubao.js";
import { FakeChatProvider, type ChatProvider } from "./types.js";

export type { ChatInput, ChatMessage, ChatProvider, StreamEvent, ToolSchema } from "./types.js";
export { FakeChatProvider } from "./types.js";

let cached: ChatProvider | null = null;

/**
 * 取当前配置的供应商。未配置密钥时返回假供应商，
 * 让接口层能给出可读提示而不是在运行时崩溃。
 */
export function getChatProvider(): ChatProvider {
  if (cached) return cached;
  cached = env.TUTOR_CHAT_API_KEY
    ? createDoubaoProvider({ apiKey: env.TUTOR_CHAT_API_KEY, baseUrl: env.TUTOR_CHAT_BASE_URL })
    : new FakeChatProvider([[{ type: "error", message: "私教尚未配置模型密钥", retryable: false }]]);
  return cached;
}

/** 仅供测试：注入供应商并绕过环境变量。 */
export function setChatProvider(provider: ChatProvider | null) {
  cached = provider;
}

export function hasChatCredentials() {
  return Boolean(env.TUTOR_CHAT_API_KEY);
}

/** 有图片时优先用视觉模型，否则用对话模型。 */
export function pickModel(hasImages: boolean) {
  if (hasImages && env.TUTOR_VISION_MODEL) return env.TUTOR_VISION_MODEL;
  return env.TUTOR_CHAT_MODEL || env.TUTOR_VISION_MODEL || "";
}
