/**
 * 火山引擎语音适配。
 *
 * 重要：语音是火山控制台单独开通的服务，凭据与豆包（方舟）API Key 不是同一套。
 * 下面几段协议以官方文档为准，**上线前必须用真实凭据跑一次并调参**，
 * 尤其儿童语音识别（准确率是体验分水岭，见 TUTOR_AGENT_DESIGN 第 11 节）。
 *
 * 鉴权有两套，官方文档明确"旧版控制台后续会下线，建议尽快切换到新版控制台获取 API Key"：
 *   新版控制台：X-Api-Key 单头（一个 Key 通吃识别与合成）
 *   旧版控制台：X-Api-App-Id + X-Api-Access-Key 双头（识别）／Bearer Token + AppID/Cluster（合成）
 * 所以：**有 API Key 就优先走新版**，没有才退回旧版三件套。
 */

import { createJsonObjectStream } from "./json-stream.js";

/** 旧版控制台：小模型 HTTP 非流式合成（历史文档，需要 AppID/Token/Cluster/音色） */
const TTS_LEGACY_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
/** 新版控制台：语音合成大模型「单向流式语音合成HTTP」，只要 API Key + 音色 */
const TTS_V3_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

export function createVolcTts(options: {
  appId: string;
  accessToken: string;
  cluster: string;
  voiceType: string;
}) {
  return {
    async synthesize(text: string): Promise<{ audio: Buffer; contentType: string }> {
      const response = await fetch(TTS_LEGACY_ENDPOINT, {
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
        const body = await response.text().catch(() => "");
        throw new Error(`语音合成失败：HTTP ${response.status} ${body.slice(0, 200)}`);
      }
      const payload: any = await response.json();
      if (!payload?.data) {
        // 火山 TTS 的业务错误也是 HTTP 200：鉴权、cluster、音色填错都走这里，
        // 所以必须把上游 code/message 带出去，否则前端只看得到"未返回音频"。
        const code = payload?.code !== undefined ? `code=${payload.code} ` : "";
        throw new Error(`语音合成失败：${code}${payload?.message || "未返回音频"}`);
      }
      return { audio: Buffer.from(payload.data, "base64"), contentType: "audio/mpeg" };
    },
  };
}

/**
 * 语音合成大模型（新版控制台，API Key 单头）。
 *
 * 响应是 chunked 的一串 JSON 对象，每段带一段 base64 音频，所以要边收边拆再拼起来。
 * 教育场景可用参数：`latex_parser: "v2"`（数学公式按读法朗读）、语速/音量、
 * `disable_markdown_filter`（去掉 Markdown 符号，否则"**加粗**"会被念出来）。
 */
export function createVolcTtsV3(options: {
  apiKey: string;
  resourceId: string;
  speaker: string;
  format?: string;
  sampleRate?: number;
  speechRate?: number;
}) {
  const format = options.format || "mp3";
  return {
    async synthesize(text: string): Promise<{ audio: Buffer; contentType: string }> {
      const response = await fetch(TTS_V3_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": options.apiKey,
          "X-Api-Resource-Id": options.resourceId,
          "X-Api-Request-Id": `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        },
        body: JSON.stringify({
          req_params: {
            text,
            speaker: options.speaker,
            audio_params: {
              format,
              sample_rate: options.sampleRate || 24000,
              speech_rate: options.speechRate ?? 0,
              // 去掉 Markdown 符号与 Emoji，别把 ** 念出来
              disable_markdown_filter: true,
              disable_emoji_filter: true,
            },
            additions: JSON.stringify({ latex_parser: "v2" }),
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`语音合成失败：HTTP ${response.status} ${body.slice(0, 200)}`);
      }
      if (!response.body) throw new Error("语音合成失败：上游没有返回音频流");

      const stream = createJsonObjectStream();
      const chunks: string[] = [];
      let failure = "";

      const decoder = new TextDecoder();
      for await (const raw of response.body as any) {
        for (const message of stream.push(decoder.decode(raw, { stream: true }))) {
          // code 0 表示这一段成功；非 0 直接把它当失败原因带出去
          if (message?.code !== undefined && Number(message.code) !== 0) {
            failure = failure || `code=${message.code} ${message.message || ""}`.trim();
            continue;
          }
          if (typeof message?.data === "string" && message.data) chunks.push(message.data);
        }
      }
      for (const message of stream.flush()) {
        if (message?.code !== undefined && Number(message.code) !== 0) {
          failure = failure || `code=${message.code} ${message.message || ""}`.trim();
        }
        if (typeof message?.data === "string" && message.data) chunks.push(message.data);
      }

      if (failure) throw new Error(`语音合成失败：${failure}`);
      if (!chunks.length) throw new Error("语音合成失败：没有返回音频数据");

      const contentType = format === "mp3" ? "audio/mpeg" : format === "wav" ? "audio/wav" : "application/octet-stream";
      return { audio: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64"))), contentType };
    },
  };
}

const ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";

export function createVolcAsr(options: { apiKey?: string; appId?: string; accessToken?: string; cluster?: string }) {
  return {
    async transcribe(audio: Buffer, format: string): Promise<string> {
      // 新版控制台只有 API Key；旧版控制台是 App ID + Access Token 双头。
      // 两个头名在官方不同文档里出现过 X-Api-App-Id 与 X-Api-App-Key 两种写法，
      // 旧版就都带上，避免因文档口径不一致而调不通。
      const authHeaders: Record<string, string> = options.apiKey
        ? { "X-Api-Key": options.apiKey }
        : {
            "X-Api-App-Id": options.appId || "",
            "X-Api-App-Key": options.appId || "",
            "X-Api-Access-Key": options.accessToken || "",
          };
      const response = await fetch(ASR_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
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
        const body = await response.text().catch(() => "");
        throw new Error(`语音识别失败：HTTP ${response.status} ${body.slice(0, 200)}`);
      }
      const payload: any = await response.json();
      const text = payload?.result?.text || payload?.result?.utterances?.map((item: any) => item.text).join("") || "";
      // 识别失败时正文常常是空对象，真正的 code/message 在响应头里
      if (!text) {
        const status = response.headers.get("x-api-status-code") || "";
        const message = response.headers.get("x-api-message") || "未识别出内容";
        throw new Error(`语音识别失败：${status ? `code=${status} ` : ""}${message}`);
      }
      return String(text || "").trim();
    },
  };
}
