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
 *   --list-voices                       列出本账号真正可用的音色（逐个试，能出声才算可用）
 *   --list-voices --candidates=a,b,c    只试自己给的这几个音色 ID
 *
 * 它做的是一圈**闭环**：先合成一句「今天我们一起把这道题弄明白」，
 * 再把这段音频回灌给识别，比对读回来的字。这一圈过了，等于同时证明
 * **凭据、音色、资源标识三样全对**，而不是"单个接口没报错"。
 *
 * 只发一条十几字的短句，费用可以忽略。
 */
import { createJsonObjectStream } from "../apps/api/src/tutor/voice/json-stream.js";
import { isVolcSuccessCode } from "../apps/api/src/tutor/voice/volcengine.js";
import { resolveVoiceCredentials } from "../apps/api/src/tutor/voice/credentials.js";
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
    speaker:
      args["speaker"] ||
      args["tts-speaker"] ||
      args["tts-voice"] ||
      process.env.TUTOR_TTS_SPEAKER ||
      process.env.TUTOR_TTS_VOICE_TYPE ||
      "",
  },
};

// 与线上服务端共用同一套凭据解析规则：App ID / Token 两栏共享，只填一栏也当两栏有
const resolved = resolveVoiceCredentials({
  asrApiKey: config.asr.apiKey,
  ttsApiKey: config.tts.apiKey,
  ttsSpeaker: config.tts.speaker,
  asrAppId: config.asr.appId,
  asrAccessToken: config.asr.token,
  ttsAppId: config.tts.appId,
  ttsAccessToken: config.tts.token,
  ttsCluster: config.tts.cluster,
});
const protocol = (args["tts-protocol"] || resolved.protocol) as "v3" | "legacy";

const asrOnly = "asr-only" in args;
const ttsOnly = "tts-only" in args;
// 只验识别时需要一段现成音频：整条闭环要合成声源，而 --asr-only 恰恰跳过了合成
const asrAudioPath = args["asr-audio"] || "";
const result: any = {
  mode: resolved.apiKey ? "api-key（单头）" : "app-id/token（双头）",
  ttsProtocol: protocol,
  steps: {} as Record<string, unknown>,
  errors: [] as string[],
  pass: false,
};

console.log(`鉴权方式：${result.mode}`);
console.log("");

async function synthesize(
  text: string,
  speakerOverride?: string,
): Promise<{ ok: true; audio: Buffer } | { ok: false; reason: string }> {
  const speaker = speakerOverride || resolved.speaker;
  if (protocol === "v3") {
    if (!speaker) {
      return { ok: false, reason: "语音合成缺少参数：speaker（音色 ID，控制台「音色库」里抄一个）" };
    }
    if (!resolved.ttsApiKey && !(resolved.ttsAppId && resolved.ttsAccessToken)) {
      return { ok: false, reason: "语音合成缺少凭据：给 --api-key=，或 --tts-app-id= 与 --tts-token=" };
    }
    // 有 API Key 用单头；否则用 App ID + Access Token 双头（老控制台，实测同样可用）
    const authHeaders = resolved.ttsApiKey
      ? { "X-Api-Key": resolved.ttsApiKey }
      : { "X-Api-App-Key": resolved.ttsAppId, "X-Api-Access-Key": resolved.ttsAccessToken };
    const response = await fetch(TTS_V3_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        "X-Api-Resource-Id": config.tts.resourceId,
        "X-Api-Request-Id": `${Date.now()}`,
      },
      body: JSON.stringify({
        req_params: {
          text,
          speaker,
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
    const collect = (message: any) => {
      // 成功码不止 0：流末尾的 {"code":20000000,"message":"OK"} 是正常结束标记
      if (message?.code !== undefined && !isVolcSuccessCode(message.code)) {
        failure = failure || `code=${message.code} ${message.message || ""}`.trim();
        return;
      }
      if (typeof message?.data === "string" && message.data) chunks.push(message.data);
    };
    const decoder = new TextDecoder();
    for await (const raw of response.body as any) {
      for (const message of stream.push(decoder.decode(raw as Uint8Array, { stream: true }))) collect(message);
    }
    for (const message of stream.flush()) collect(message);
    if (failure) return { ok: false, reason: humanizeVoiceError({ part: "tts", status: 200, body: { message: failure } }) };
    if (!chunks.length) return { ok: false, reason: "语音合成失败：上游没有返回音频数据" };
    return { ok: true, audio: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk, "base64"))) };
  }

  // 旧协议（/api/v1/tts）需要 App ID + Token + Cluster + 音色
  const legacyValues: Record<string, string> = {
    appId: resolved.ttsAppId,
    token: resolved.ttsAccessToken,
    cluster: config.tts.cluster,
    speaker: resolved.speaker,
  };
  const missing = Object.keys(legacyValues).filter((key) => !legacyValues[key]);
  if (missing.length) return { ok: false, reason: `语音合成缺少参数：${missing.join(", ")}` };
  const response = await fetch(TTS_LEGACY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer;${resolved.ttsAccessToken}` },
    body: JSON.stringify({
      app: { appid: resolved.ttsAppId, token: resolved.ttsAccessToken, cluster: config.tts.cluster },
      user: { uid: "heya-voice-check" },
      audio: { voice_type: resolved.speaker, encoding: "mp3", speed_ratio: 1.0 },
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
  if (!resolved.asrApiKey && !(resolved.asrAppId && resolved.asrAccessToken)) {
    return { ok: false, reason: "语音识别缺少参数：appId, token" };
  }
  const authHeaders = resolved.asrApiKey
    ? { "X-Api-Key": resolved.asrApiKey }
    : { "X-Api-App-Key": resolved.asrAppId, "X-Api-Access-Key": resolved.asrAccessToken };
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
// 只列音色：逐个真发一次短句，能出声才算可用（控制台列表里有一大堆，但账号没开通的用不了）
if ("list-voices" in args) {
  // 默认可疑清单：在线文档里常见的"大模型音色"。注意 mars/moon 结尾的那批属于别的 resource，
  // 在本账号上会报 "resource ID is mismatched with speaker related resource"。
  const defaults = [
    "zh_female_vv_uranus_bigtts",
    "zh_female_cancan_uranus_bigtts",
    "zh_female_xiaohe_uranus_bigtts",
    "zh_female_tianmeixiaoyuan_uranus_bigtts",
    "zh_female_qingxinnvsheng_uranus_bigtts",
    "zh_male_wennuanahu_uranus_bigtts",
    "zh_male_qingshuangnanda_uranus_bigtts",
    "zh_male_yangguangqingnian_uranus_bigtts",
    "zh_male_kailangxuezhang_uranus_bigtts",
    "zh_male_qingcang_uranus_bigtts",
  ];
  const candidates = args["candidates"] ? args["candidates"].split(",").map((s) => s.trim()).filter(Boolean) : defaults;
  const available: string[] = [];
  const rejected: Array<{ speaker: string; reason: string }> = [];
  for (const speaker of candidates) {
    const one = await synthesize("你好", speaker);
    if (one.ok) {
      available.push(speaker);
      console.log(`✅ 可用   ${speaker}`);
    } else {
      rejected.push({ speaker, reason: one.reason });
      console.log(`❌ 不可用 ${speaker}`);
    }
  }
  console.log("");
  console.log(JSON.stringify({ resourceId: config.tts.resourceId, available, rejected }, null, 2));
  process.exitCode = available.length ? 0 : 1;
  process.exit(process.exitCode ?? 0);
}

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
    result.steps.tts = { bytes: audio.length, text: PROBE_TEXT, speaker: resolved.speaker, protocol };
    console.log(`✅ 语音合成通过：得到 ${audio.length} 字节 mp3（音色 ${resolved.speaker}，协议 ${protocol}）`);
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
  console.log(`bash scripts/enable-tutor.sh --key=<豆包Key> --chat-model=<模型ID> \\`);
  if (resolved.apiKey) {
    console.log(`  --voice-api-key=${apiKey} --tts-speaker=${resolved.speaker}`);
  } else {
    console.log(`  --asr-app-id=${resolved.asrAppId} --asr-token=<已填> --tts-speaker=${resolved.speaker}`);
  }
} else {
  console.log("❌ 未通过。上面每条 ❌ 都带上了上游原始 code/message，可对着火山语音文档查。");
}

console.log("");
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.pass ? 0 : 1;
