import { env } from "../../env.js";

/**
 * 语音能力抽象：识别（ASR）与合成（TTS）。
 * 不自研声学模型，租用云服务；本层只做协议适配与降级。
 *
 * 注意：语音是火山控制台里**单独开通**的服务，凭据与豆包 API Key 不是同一套。
 * 未配置时如实返回"未开通"，前端据此隐藏语音按钮，而不是静默失败。
 */

export type VoiceStatus = {
  asr: boolean;
  tts: boolean;
};

export function getVoiceStatus(): VoiceStatus {
  return {
    asr: Boolean(env.TUTOR_ASR_APP_ID && env.TUTOR_ASR_ACCESS_TOKEN),
    tts: Boolean(env.TUTOR_TTS_APP_ID && env.TUTOR_TTS_ACCESS_TOKEN),
  };
}

export class VoiceNotConfiguredError extends Error {
  constructor(part: "asr" | "tts") {
    super(part === "asr" ? "语音识别尚未开通" : "语音朗读尚未开通");
    this.name = "VoiceNotConfiguredError";
  }
}

/**
 * 文字转语音。返回音频字节与内容类型。
 * 具体厂商协议在实现时按其官方文档对接；此处保留统一出入口，
 * 上层（前端与路由）不感知厂商差异。
 */
export async function synthesize(text: string, voiceType?: string): Promise<{ audio: Buffer; contentType: string }> {
  if (!getVoiceStatus().tts) throw new VoiceNotConfiguredError("tts");
  const { createVolcTts } = await import("./volcengine.js");
  return createVolcTts({
    appId: env.TUTOR_TTS_APP_ID,
    accessToken: env.TUTOR_TTS_ACCESS_TOKEN,
    cluster: env.TUTOR_TTS_CLUSTER,
    voiceType: voiceType || env.TUTOR_TTS_VOICE_TYPE,
  }).synthesize(text);
}

/**
 * 语音转文字。接受音频字节，返回识别文本。
 * 儿童语音识别准确率明显低于成人：上线前必须用真实儿童录音实测。
 */
export async function transcribe(audio: Buffer, format: string): Promise<string> {
  if (!getVoiceStatus().asr) throw new VoiceNotConfiguredError("asr");
  const { createVolcAsr } = await import("./volcengine.js");
  return createVolcAsr({
    appId: env.TUTOR_ASR_APP_ID,
    accessToken: env.TUTOR_ASR_ACCESS_TOKEN,
    cluster: env.TUTOR_ASR_CLUSTER,
  }).transcribe(audio, format);
}
