#!/usr/bin/env node
/**
 * 火山引擎「语音技术」凭据自检（本机运行，不经过本项目服务）。
 *
 * 为什么做成"合成一句 → 再识别回来"的一圈：
 * 识别与合成的凭据、cluster、音色任意一项填错，单独试都只能得到一句模糊报错，
 * 而这一圈能一次性证明三件事全对，并且顺带证明合成出来的音频真的能被识别。
 *
 * 用法：
 *   node scripts/check-voice.mjs --asr-app-id=xxx --asr-token=xxx --asr-cluster=xxx \
 *                               --tts-app-id=xxx --tts-token=xxx --tts-cluster=xxx --tts-voice=xxx
 *   node scripts/check-voice.mjs --asr-only ...   # 只验识别
 *   node scripts/check-voice.mjs --tts-only ...   # 只验合成
 *
 * 只发一条十几字的短句，费用可以忽略。
 */
import { humanizeVoiceError, judgeRoundTrip } from "./lib/voice-check.mjs";

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const ASR_ENDPOINT = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const PROBE_TEXT = "今天我们一起把这道题弄明白";

const args = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, ...rest] = raw.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);

const config = {
  asr: {
    appId: args["asr-app-id"] || process.env.TUTOR_ASR_APP_ID || "",
    token: args["asr-token"] || process.env.TUTOR_ASR_ACCESS_TOKEN || "",
    cluster: args["asr-cluster"] || process.env.TUTOR_ASR_CLUSTER || "volc.bigasr.auc_turbo",
  },
  tts: {
    appId: args["tts-app-id"] || process.env.TUTOR_TTS_APP_ID || "",
    token: args["tts-token"] || process.env.TUTOR_TTS_ACCESS_TOKEN || "",
    cluster: args["tts-cluster"] || process.env.TUTOR_TTS_CLUSTER || "",
    voice: args["tts-voice"] || process.env.TUTOR_TTS_VOICE_TYPE || "",
  },
};

const asrOnly = "asr-only" in args;
const ttsOnly = "tts-only" in args;
const result = { steps: {}, errors: [], pass: false };

function requireAll(values, part, label) {
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    result.errors.push(`${label}缺少参数：${missing.join(", ")}`);
    return false;
  }
  return true;
}

async function synthesize(text) {
  const response = await fetch(TTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer;${config.tts.token}` },
    body: JSON.stringify({
      app: { appid: config.tts.appId, token: config.tts.token, cluster: config.tts.cluster },
      user: { uid: "heya-voice-check" },
      audio: { voice_type: config.tts.voice, encoding: "mp3", speed_ratio: 1.0 },
      request: { reqid: `${Date.now()}`, text, operation: "query" },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  // 关键：火山 TTS 的业务错误也是 HTTP 200，必须看 data 在不在
  if (!response.ok || !payload?.data) {
    return { ok: false, reason: humanizeVoiceError({ part: "tts", status: response.status, body: payload }) };
  }
  return { ok: true, audio: Buffer.from(payload.data, "base64") };
}

async function transcribe(audio, format) {
  const response = await fetch(ASR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Key": config.asr.appId,
      "X-Api-Access-Key": config.asr.token,
      "X-Api-Resource-Id": config.asr.cluster,
      "X-Api-Request-Id": `${Date.now()}`,
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      user: { uid: "heya-voice-check" },
      audio: { format, data: audio.toString("base64") },
      request: { model_name: "bigmodel", enable_punc: true },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  // ASR v3 的错误信息在响应头里，正文可能是空对象
  const headerStatus = response.headers.get("x-api-status-code");
  const headerMessage = response.headers.get("x-api-message");
  const text = payload?.result?.text || payload?.result?.utterances?.map((item) => item.text).join("") || "";
  if (!response.ok || !text) {
    const body = headerStatus || headerMessage ? { code: headerStatus, message: headerMessage } : payload;
    return { ok: false, reason: humanizeVoiceError({ part: "asr", status: response.status, body }) };
  }
  return { ok: true, text: String(text).trim() };
}

// ---- 合成 ----
let audio = null;
if (!asrOnly) {
  if (!requireAll(config.tts, "tts", "语音合成")) {
    console.log(`❌ ${result.errors.at(-1)}`);
  } else {
    const spoken = await synthesize(PROBE_TEXT);
    if (!spoken.ok) {
      result.errors.push(spoken.reason);
      console.log(`❌ ${spoken.reason}`);
    } else {
      audio = spoken.audio;
      result.steps.tts = { bytes: audio.length, text: PROBE_TEXT };
      console.log(`✅ 语音合成通过：得到 ${audio.length} 字节 mp3（音色 ${config.tts.voice}，cluster ${config.tts.cluster}）`);
    }
  }
}

// ---- 识别（有合成结果时回灌，等于验证整条链路）----
if (!ttsOnly) {
  const asrInput = audio ?? null;
  if (!asrInput) {
    if (requireAll(config.asr, "asr", "语音识别")) {
      console.log("⏭  跳过识别：没有可回灌的音频（加 --tts-only 可静默），单独验识别请去掉 --tts-only 并补合成凭据");
    } else {
      console.log(`❌ ${result.errors.at(-1)}`);
    }
  } else if (!requireAll(config.asr, "asr", "语音识别")) {
    console.log(`❌ ${result.errors.at(-1)}`);
  } else {
    const heard = await transcribe(asrInput, "mp3");
    if (!heard.ok) {
      result.errors.push(heard.reason);
      console.log(`❌ ${heard.reason}`);
    } else {
      const judged = judgeRoundTrip(PROBE_TEXT, heard.text);
      result.steps.asr = { heard: heard.text, ...judged };
      if (judged.passed) {
        console.log(`✅ 语音识别通过：读回「${heard.text}」（相似度 ${judged.score}）`);
        console.log("   整条链路可信：凭据 + cluster + 音色都对，合成音频能被识别");
      } else {
        const reason = `识别结果与原文差得太多（相似度 ${judged.score} < ${judged.threshold}）：读回「${heard.text}」`;
        result.errors.push(reason);
        console.log(`⚠️ ${reason}`);
      }
    }
  }
}

result.pass = result.errors.length === 0 && Object.keys(result.steps).length > 0;

if (result.pass) {
  console.log("");
  console.log("据此可以往服务器 .env 里写：");
  console.log(`TUTOR_ASR_APP_ID=${config.asr.appId}`);
  console.log(`TUTOR_ASR_ACCESS_TOKEN=${config.asr.token ? "<已填>" : ""}`);
  console.log(`TUTOR_ASR_CLUSTER=${config.asr.cluster}`);
  console.log(`TUTOR_TTS_APP_ID=${config.tts.appId}`);
  console.log(`TUTOR_TTS_ACCESS_TOKEN=${config.tts.token ? "<已填>" : ""}`);
  console.log(`TUTOR_TTS_CLUSTER=${config.tts.cluster}`);
  console.log(`TUTOR_TTS_VOICE_TYPE=${config.tts.voice}`);
} else {
  console.log("");
  console.log("❌ 未通过。上面每条 ❌ 都带上了上游原始 code/message，可对着火山语音文档查。");
}

process.exitCode = result.pass ? 0 : 1;
