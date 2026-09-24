import { env } from "../../env.js";
import { resolveVoiceCredentials } from "./credentials.js";

/**
 * 语音能力抽象：识别（ASR）与合成（TTS）。
 * 不自研声学模型，租用云服务；本层只做协议适配与降级。
 *
 * 注意：语音是火山控制台里**单独开通**的服务，凭据与豆包 API Key 不是同一套。
 * 未配置时如实返回"未开通"，前端据此隐藏语音按钮，而不是静默失败。
 *
 * 鉴权优先新版控制台的 API Key：一个 Key 同时覆盖识别与合成，
 * 不用再去凑 AppID / Access Token / Cluster 三件套（旧版控制台后续会下线）。
 */

export type VoiceStatus = {
  asr: boolean;
  tts: boolean;
  /** 连续对话静默多久自动关麦克风，毫秒。前端据此给免提模式加兜底。 */
  idle_ms: number;
};

/** 识别与合成共用同一把 API Key（新版控制台），只填一栏也当两栏都有 */
function credentials() {
  return resolveVoiceCredentials({
    asrApiKey: env.TUTOR_ASR_API_KEY,
    ttsApiKey: env.TUTOR_TTS_API_KEY,
    ttsSpeaker: env.TUTOR_TTS_SPEAKER,
    ttsVoiceType: env.TUTOR_TTS_VOICE_TYPE,
    asrAppId: env.TUTOR_ASR_APP_ID,
    asrAccessToken: env.TUTOR_ASR_ACCESS_TOKEN,
    ttsAppId: env.TUTOR_TTS_APP_ID,
    ttsAccessToken: env.TUTOR_TTS_ACCESS_TOKEN,
    ttsCluster: env.TUTOR_TTS_CLUSTER,
  });
}

export function getVoiceStatus(): VoiceStatus {
  return { ...credentials().status, idle_ms: env.TUTOR_VOICE_IDLE_MS };
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
  const resolved = credentials();
  if (!resolved.status.tts) throw new VoiceNotConfiguredError("tts");

  if (resolved.protocol === "v3") {
    const { createVolcTtsV3 } = await import("./volcengine.js");
    return createVolcTtsV3({
      apiKey: resolved.ttsApiKey || undefined,
      appId: resolved.ttsAppId || undefined,
      accessToken: resolved.ttsAccessToken || undefined,
      resourceId: env.TUTOR_TTS_RESOURCE_ID,
      // 前端传音色时以调用方为准，否则用后台配的那个
      speaker: voiceType || resolved.speaker,
      speechRate: env.TUTOR_TTS_SPEECH_RATE,
    }).synthesize(text);
  }

  const { createVolcTts } = await import("./volcengine.js");
  return createVolcTts({
    appId: resolved.ttsAppId,
    accessToken: resolved.ttsAccessToken,
    cluster: env.TUTOR_TTS_CLUSTER,
    voiceType: voiceType || resolved.speaker,
  }).synthesize(text);
}

/**
 * 语音转文字。接受音频字节，返回识别文本。
 * 儿童语音识别准确率明显低于成人：上线前必须用真实儿童录音实测。
 */
export async function transcribe(audio: Buffer, format: string): Promise<string> {
  const resolved = credentials();
  if (!resolved.status.asr) throw new VoiceNotConfiguredError("asr");
  const { createVolcAsr } = await import("./volcengine.js");
  return createVolcAsr({
    apiKey: resolved.asrApiKey || undefined,
    appId: resolved.asrAppId,
    accessToken: resolved.asrAccessToken,
    cluster: env.TUTOR_ASR_CLUSTER || env.TUTOR_ASR_RESOURCE_ID,
  }).transcribe(audio, format);
}
