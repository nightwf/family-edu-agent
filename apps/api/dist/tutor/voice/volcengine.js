/**
 * 火山引擎语音适配。
 *
 * 重要：语音是火山控制台单独开通的服务，凭据与豆包（方舟）API Key 不是同一套。
 * 下面两段协议以官方文档为准，**上线前必须用真实凭据跑一次并调参**，
 * 尤其儿童语音识别（准确率是体验分水岭，见 TUTOR_AGENT_DESIGN 第 11 节）。
 */
const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
export function createVolcTts(options) {
    return {
        async synthesize(text) {
            const response = await fetch(TTS_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer;${options.accessToken}`,
                },
                body: JSON.stringify({
                    app: { appid: options.appId, token: options.accessToken, cluster: options.cluster },
                    user: { uid: "heya-tutor" },
                    audio: {
                        voice_type: options.voiceType,
                        encoding: "mp3",
                        speed_ratio: 1.0,
                    },
                    request: {
                        reqid: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                        text,
                        operation: "query",
                    },
                }),
            });
            if (!response.ok) {
                throw new Error(`语音合成失败：${response.status}`);
            }
            const payload = await response.json();
            if (!payload?.data) {
                throw new Error(`语音合成失败：${payload?.message || "未返回音频"}`);
            }
            return { audio: Buffer.from(payload.data, "base64"), contentType: "audio/mpeg" };
        },
    };
}
const ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
export function createVolcAsr(options) {
    return {
        async transcribe(audio, format) {
            const response = await fetch(ASR_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-App-Key": options.appId,
                    "X-Api-Access-Key": options.accessToken,
                    "X-Api-Resource-Id": options.cluster || "volc.bigasr.auc_turbo",
                    "X-Api-Request-Id": `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    "X-Api-Sequence": "-1",
                },
                body: JSON.stringify({
                    user: { uid: "heya-tutor" },
                    audio: { format, data: audio.toString("base64") },
                    request: { model_name: "bigmodel", enable_punc: true },
                }),
            });
            if (!response.ok) {
                throw new Error(`语音识别失败：${response.status}`);
            }
            const payload = await response.json();
            const text = payload?.result?.text || payload?.result?.utterances?.map((item) => item.text).join("") || "";
            return String(text || "").trim();
        },
    };
}
