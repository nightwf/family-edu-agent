/**
 * 语音链路的语义化错误。
 *
 * 单独一个模块，是因为它在三处都要用到，而且不能互相引：
 * 识别适配层（volcengine.ts）要抛它、路由层要判它、测试要造它。
 * 适配层是动态 import 的，从 index.ts 静态转发会绕成环。
 */

/**
 * 这段录音里没有人说话（火山 `code=20000003`「Normal silence audio」）。
 *
 * 上游把它归在**正常结果**里，不是故障：孩子按了录音又马上松开、
 * 犹豫了半天没出声、或者只说了一半又咽回去，都会走到这里。
 * 所以调用方必须把它和"识别失败"分开：不弹红字，只轻轻提示一句
 * "没听到声音，再说一次"，否则孩子会以为工具坏了。
 */
export class VoiceNoSpeechError extends Error {
  constructor(detail = "") {
    super(detail ? `没有听到说话声：${detail}` : "没有听到说话声");
    this.name = "VoiceNoSpeechError";
  }
}

/** 火山返回的"这段话里没有有效语音"状态码。 */
const VOLC_NO_SPEECH_CODES = new Set([20000003]);

export function isNoSpeechCode(code: unknown): boolean {
  if (code === undefined || code === null || code === "") return false;
  return VOLC_NO_SPEECH_CODES.has(Number(code));
}

/** 有些链路上游只回文字不回码，所以再按文案兜一层。 */
export function looksLikeNoSpeech(message: string): boolean {
  return /no valid speech|silence audio/i.test(message);
}
