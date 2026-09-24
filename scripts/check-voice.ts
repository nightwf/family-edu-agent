#!/usr/bin/env node
/**
 * 火山引擎「语音技术」凭据自检（本机运行，不经过本项目服务）。
 *
 * 两种鉴权方式都支持，**推荐新版控制台的 API Key**（一个 Key 同时覆盖识别与合成，
 * 官方文档明确旧版控制台后续会下线）：
 *
 *   新版：node scripts/check-voice.mjs --api-key=xxx --speaker=zh_female_vv_uranus_bigtts
 *   旧版：node scripts/check-voice.mjs --asr-app-id= --asr-token= --asr-cluster= \
 *                               --tts-app-id= --tts-token= --tts-cluster= --tts-voice=
 *
 * 只想单独验其中一项：
 *   --tts-only                          只合成，不识别
 *   --asr-only --asr-audio=/path/a.mp3  只识别（要自己有音频，因为合成被跳过了）
 *
 * 它做的是一圈**闭环**：先合成一句「今天我们一起把这道题弄明白」，
 * 再把这段音频回灌给识别，比对读回来的字。这一圈过了，等于同时证明
 * **凭据、音色、资源标识三样全对**，而不是"单个接口没报错"。
 *
 * 只发一条十几字的短句，费用可以忽略。
 */
import { createJsonObjectStream } from "../apps/api/src/tutor/voice/json-stream.js";
import { humanizeVoiceError, judgeRoundTrip } from "./lib/voice-check.mjs";
import { readFileSync } from "node:fs";

const TTS_LEGACY_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const TTS_V3_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const PROBE_TEXT = "今天我们一起把这道题弄明白";

const args = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, ...rest] = raw.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

const apiKey = args["api-key"] || process.env.TUTOR_VOICE_API_KEY || "";
const usingApiKey = Boolean(apiKey);

const config = {
  asr: {
    apiKey,
    appId: args["asr-app-id"] || process.env.TUTOR_ASR_APP_ID || "",
    token: args["asr-token"] || process.env.TUTOR_ASR_ACCESS_TOKEN || "",
    // 极速版的资源标识固定是 volc.bigasr.auc_turbo
    resourceId: args["asr-resource-id"] || args["asr-cluster"] || process.env.TUTOR_ASR_RESOURCE_ID || "volc.bigasr.auc_turbo",
  },
  tts: {
    apiKey,
    appId: args["tts-app-id"] || process.env.TUTOR_TTS_APP_ID || "",
    token: args["tts-token"] || process.env.TUTOR_TTS_ACCESS_TOKEN || "",
    cluster: args["tts-cluster"] || process.env.TUTOR_TTS_CLUSTER || "",
    resourceId: args["tts-resource-id"] || process.env.TUTOR_TTS_RESOURCE_ID || "seed-tts-2.0",
    speaker: args["speaker"] || args["tts-voice"] || process.env.TUTOR_TTS_SPEAKER || "",
  },
};

const asrOnly = "asr-only" in args;
const ttsOnly = "tts-only" in args;
// 只验识别时需要一段现成音频：整条闭环要合成声源，而 --asr-only 恰恰跳过了合成
const asrAudioPath = args["asr-audio"] || "";
const result: any = {
  mode: usingApiKey ? "api-key（新版控制台）" : "app-id/token（旧版控制台）",
  steps: {} as Record<string, unknown>,
  errors: [] as string[],
  pass: false,
};

console.log(`鉴权方式：${result.mode}`);
console.log("");

async function synthesize(text: string): Promise<{ ok: true; audio: Buffer } | { ok: false; reason: string }> {
  if (usingApiKey) {
    if (!config.tts.speaker) {
      return { ok: false, reason: "语音合成缺少参数：speaker（音色 ID，控制台「音色库」里抄一个）" };
    }
    const response = await fetch(TTS_V3_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.tts.apiKey,
        "X-Api-Resource-Id": config.tts.resourceId,
        "X-Api-Request-Id": `${Date.now()}`,
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker: config.tts.speaker,
          audio_params: { format: "mp3", sample_rate: 24000, disable_markdown_filter: true, disable_emoji_filter: true },
          additions: JSON.stringify({ latex_parser: "v2" }),
        },
      }),
    });
    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      return { ok: false, reason: humanizeVoiceError({ part: "tts", status: response.status, body }) };
    }
    const stream = createJsonObjectStream();
    const chunks: string[] = [];
    let failure = "";
    const decoder = new TextDecoder();
    for await (const raw of response.body as any) {
      for (const message of stream.push(decoder.decode(raw as Uint8Array, { stream: true }))) {
        if (message?.code !== undefined && Number(message.code) !== 0) failure = failure || `code=${message.code} ${message.message || ""}`.trim();
        if (typeof message?.data === "string" && message.data) chunks.push(message.data);
      }
    }
    for (const message of stream.flush()) {
      if (message?.code !== undefined && Number(message.code) !== 0) failure = failure || `code=${message.code} ${message.message || ""}`.trim();
      if (typeof message?.data === "string" && message.data) chunks.push(message.data);
    }
    if (failure) return { ok: false, reason: humanizeVoiceError({ part: "tts", status: 200, body: { message: failure } }) };
    if (!chunks.length) return { ok: false, reason: "语音合成失败：上游没有返回音频数据" };
    return { ok: true, audio: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64"))) };
  }

  const missing = ["appId", "token", "cluster", "speaker"].filter((key) => !config.tts[key]);
  if (missing.length) return { ok: false, reason: `语音合成缺少参数：${missing.join(", ")}` };
  const response = await fetch(TTS_LEGACY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer;${config.tts.token}` },
    body: JSON.stringify({
      app: { appid: config.tts.appId, token: config.tts.token, cluster: config.tts.cluster },
      user: { uid: "heya-voice-check" },
      audio: { voice_type: config.tts.speaker, encoding: "mp3", speed_ratio: 1.0 },
      request: { reqid: `${Date.now()}`, text, operation: "query" },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  // 火山 TTS 的业务错误也是 HTTP 200，必须看 data 在不在
  if (!response.ok || !payload?.data) {
    return { ok: false, reason: humanizeVoiceError({ part: "tts", status: response.status, body: payload }) };
  }
  return { ok: true, audio: Buffer.from(payload.data, "base64") };
}

async function transcribe(audio: Buffer, format: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  if (!usingApiKey && !(config.asr.appId && config.asr.token)) {
    return { ok: false, reason: "语音识别缺少参数：appId, token" };
  }
  const authHeaders = usingApiKey
    ? { "X-Api-Key": config.asr.apiKey }
    : { "X-Api-App-Id": config.asr.appId, "X-Api-App-Key": config.asr.appId, "X-Api-Access-Key": config.asr.token };
  const response = await fetch(ASR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      "X-Api-Resource-Id": config.asr.resourceId,
      "X-Api-Request-Id": `${Date.now()}`,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: "heya-voice-check" },
      // 官方文档：audio.url 与 audio.data 二选一，这里用 base64 直传，免去公网可访问的音频链接
      audio: { format, data: audio.toString("base64") },
      request: { model_name: "bigmodel", enable_punc: true },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const headerStatus = response.headers.get("x-api-status-code");
  const headerMessage = response.headers.get("x-api-message");
  const text: string =
    payload?.result?.text || payload?.result?.utterances?.map((item: any) => item.text).join("") || "";
  if (!response.ok || !text) {
    const body = headerStatus || headerMessage ? { code: headerStatus, message: headerMessage } : payload;
    return { ok: false, reason: humanizeVoiceError({ part: "asr", status: response.status, body }) };
  }
  return { ok: true, text: String(text).trim() };
}

// ---- 合成 ----
let audio: Buffer | null = null;
let audioFormat = "mp3";
if (asrOnly && asrAudioPath) {
  audio = readFileSync(asrAudioPath);
  audioFormat = (asrAudioPath.split(".").pop() || "mp3").toLowerCase();
  result.steps.tts = { skipped: true, source: asrAudioPath, bytes: audio.length };
  console.log(`⏭  跳过合成（--asr-only），改用现成音频：${asrAudioPath}（${audio.length} 字节，按 ${audioFormat} 送识别）`);
} else if (!asrOnly) {
  const spoken = await synthesize(PROBE_TEXT);
  if (!spoken.ok) {
    result.errors.push(spoken.reason);
    console.log(`❌ ${spoken.reason}`);
  } else {
    audio = spoken.audio;
    result.steps.tts = { bytes: audio.length, text: PROBE_TEXT, speaker: config.tts.speaker || "(旧版音色)" };
    console.log(`✅ 语音合成通过：得到 ${audio.length} 字节 mp3（音色 ${config.tts.speaker}）`);
  }
}

// ---- 识别（有合成结果时回灌，等于验证整条链路）----
if (!ttsOnly) {
  if (!audio) {
    if (asrOnly) {
      const reason =
        "只验识别（--asr-only）需要一段现成音频：加 --asr-audio=/path/to.mp3；" +
        "或者去掉 --asr-only，让脚本自己合成一段再回灌（推荐，能一次验通整条链路）";
      result.errors.push(reason);
      console.log(`❌ ${reason}`);
    } else {
      console.log("⏭  跳过识别：合成没成功，没有可回灌的音频");
    }
  } else {
    const heard = await transcribe(audio, audioFormat);
    if (!heard.ok) {
      result.errors.push(heard.reason);
      console.log(`❌ ${heard.reason}`);
    } else {
      const judged = judgeRoundTrip(PROBE_TEXT, heard.text);
      result.steps.asr = { heard: heard.text, resourceId: config.asr.resourceId, ...judged };
      if (judged.passed) {
        console.log(`✅ 语音识别通过：读回「${heard.text}」（相似度 ${judged.score}）`);
        console.log("");
        console.log("   整条链路可信：凭据 + 音色 + 资源标识都对，合成出来的音频真的能被识别");
      } else {
        const reason = `识别结果与原文差得太多（相似度 ${judged.score} < ${judged.threshold}）：读回「${heard.text}」`;
        result.errors.push(reason);
        console.log(`⚠️ ${reason}`);
      }
    }
  }
}

result.pass = result.errors.length === 0 && Object.keys(result.steps).length > 0;

console.log("");
if (result.pass) {
  console.log("据此启用语音（一条命令，会自动写服务器 .env 并重启）：");
  if (usingApiKey) {
    console.log(`bash scripts/enable-tutor.sh --key=<豆包Key> --chat-model=<模型ID> \\`);
    console.log(`  --asr-api-key=${apiKey} --tts-api-key=${apiKey} --tts-speaker=${config.tts.speaker}`);
  } else {
    console.log(`bash scripts/enable-tutor.sh --key=<豆包Key> --chat-model=<模型ID> \\`);
    console.log(
      `  --asr-app-id=${config.asr.appId} --asr-token=<已填> --asr-cluster=${config.asr.resourceId} \\`,
    );
    console.log(`  --tts-app-id=${config.tts.appId} --tts-token=<已填> --tts-cluster=${config.tts.cluster} --tts-voice=${config.tts.speaker}`);
  }
} else {
  console.log("❌ 未通过。上面每条 ❌ 都带上了上游原始 code/message，可对着火山语音文档查。");
}

console.log("");
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.pass ? 0 : 1;
