import { env } from "../../env.js";
import { resolveVoiceCredentials } from "./credentials.js";
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
export function getVoiceStatus() {
    return credentials().status;
}
export class VoiceNotConfiguredError extends Error {
    constructor(part) {
        super(part === "asr" ? "语音识别尚未开通" : "语音朗读尚未开通");
        this.name = "VoiceNotConfiguredError";
    }
}
/**
 * 文字转语音。返回音频字节与内容类型。
 * 具体厂商协议在实现时按其官方文档对接；此处保留统一出入口，
 * 上层（前端与路由）不感知厂商差异。
 */
export async function synthesize(text, voiceType) {
    const resolved = credentials();
    if (!resolved.status.tts)
        throw new VoiceNotConfiguredError("tts");
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
export async function transcribe(audio, format) {
    const resolved = credentials();
    if (!resolved.status.asr)
        throw new VoiceNotConfiguredError("asr");
    const { createVolcAsr } = await import("./volcengine.js");
    return createVolcAsr({
        apiKey: resolved.asrApiKey || undefined,
        appId: resolved.asrAppId,
        accessToken: resolved.asrAccessToken,
        cluster: env.TUTOR_ASR_CLUSTER || env.TUTOR_ASR_RESOURCE_ID,
    }).transcribe(audio, format);
}
