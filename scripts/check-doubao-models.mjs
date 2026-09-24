#!/usr/bin/env node
/**
 * 豆包（火山方舟）凭据自检。
 *
 * 用途：jojo 在方舟控制台开通模型、创建 API Key 之后，先在本机跑这个脚本，
 * 一次性确认「Key 是否有效」+「哪些模型 ID 真的能调」，再决定往服务器 .env 里填什么。
 *
 * 用法：
 *   TUTOR_CHAT_API_KEY=xxx node scripts/check-doubao-models.mjs
 *   node scripts/check-doubao-models.mjs --key=xxx --models=doubao-seed-1-6-250615,doubao-1-5-vision-pro-32k-250115
 *   node scripts/check-doubao-models.mjs --key=xxx --vision   # 额外验证视觉模型能否读图
 *
 * 说明：只发最小请求（max_tokens=1），费用可以忽略。
 */

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// 控制台里显示的 Model ID 会随版本更新，这里只是常见候选；
// 以「火山方舟 → 开通管理」页面上抄下来的 ID 为准（用 --models= 传进去最准）。
const CANDIDATE_MODELS = [
  "doubao-seed-1-6-250615",
  "doubao-seed-1-6-flash-250615",
  "doubao-seed-1-6-thinking-250615",
  "doubao-1-5-pro-32k-250115",
  "doubao-1-5-lite-32k-250115",
  "doubao-1-5-vision-pro-32k-250115",
  "doubao-1-5-vision-lite-250315",
  "doubao-pro-32k-241215",
  "doubao-lite-32k-240828",
];

// 1x1 透明 PNG，用来验证视觉通道，不占流量。
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7mS3wAAAAABJRU5ErkJggg==";

function parseArgs(argv) {
  const args = { key: "", baseUrl: "", models: [], vision: false };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--key=")) args.key = raw.slice(6).trim();
    else if (raw.startsWith("--base-url=")) args.baseUrl = raw.slice(11).trim();
    else if (raw.startsWith("--models="))
      args.models = raw
        .slice(9)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    else if (raw === "--vision") args.vision = true;
    else if (raw === "--help" || raw === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`豆包（火山方舟）凭据自检

用法：
  TUTOR_CHAT_API_KEY=xxx node scripts/check-doubao-models.mjs
  node scripts/check-doubao-models.mjs --key=xxx --models=<ModelID,ModelID>
  node scripts/check-doubao-models.mjs --key=xxx --vision

可选：
  --base-url=<url>   默认 ${DEFAULT_BASE_URL}
  --models=<a,b,c>   只测这几个 Model ID（优先用控制台抄下来的）
  --vision           额外验证视觉模型能否读图（需要 --models 里含视觉模型）
`);
}

/** 把上游错误压成一句人话，便于定位是 Key、开通还是余额问题。 */
function explain(status, bodyText) {
  const body = (bodyText || "").slice(0, 300);
  const lower = body.toLowerCase();
  if (status === 401 || lower.includes("invalid api key") || lower.includes("authentication"))
    return "API Key 无效或填错（检查有没有多余空格、是不是方舟的 Key）";
  if (lower.includes("modelnotopen") || lower.includes("not activated") || lower.includes("not found"))
    return "该模型未开通，去「火山方舟 → 开通管理」勾选它";
  if (lower.includes("overdue") || lower.includes("balance") || lower.includes("insufficient"))
    return "账户欠费或余额不足，需要充值（或免费额度已用完）";
  if (status === 429) return "触发限流/配额，稍后重试或检查模型的 RPM/TPM 限制";
  if (status === 403) return "无权限：多为未实名认证、未开通该模型，或 Key 没有该模型的访问权";
  if (status === 404) return "路径或模型不存在：确认 Base URL 是 /api/v3，模型 ID 拼写正确";
  if (status >= 500) return "上游服务异常，稍后重试";
  return "调用失败";
}

async function probe(baseUrl, key, model, vision) {
  const content = vision
    ? [
        { type: "text", text: "这张图是什么颜色？只回一个字。" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG}` } },
      ]
    : "只回复：ok";

  const started = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "请求超时（30 秒）" : `网络不可达：${error?.message || error}`;
    return { model, vision, ok: false, ms: Date.now() - started, note: reason };
  }

  const ms = Date.now() - started;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { model, vision, ok: false, ms, note: `HTTP ${response.status} · ${explain(response.status, text)}` };
  }

  const payload = await response.json().catch(() => null);
  const reply = payload?.choices?.[0]?.message?.content;
  const usage = payload?.usage;
  return {
    model,
    vision,
    ok: true,
    ms,
    note: `返回「${String(reply ?? "").trim().slice(0, 20) || "(空)"}」${
      usage ? ` · tokens ${usage.prompt_tokens ?? "?"}/${usage.completion_tokens ?? "?"}` : ""
    }`,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return printHelp();

  const key = args.key || process.env.TUTOR_CHAT_API_KEY || "";
  const baseUrl = (args.baseUrl || process.env.TUTOR_CHAT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (!key) {
    console.error("缺少 API Key。用 --key=xxx，或先 export TUTOR_CHAT_API_KEY=xxx。");
    console.error("拿 Key 的位置：火山方舟控制台 → API Key 管理 → 创建 API Key。");
    process.exitCode = 2;
    return;
  }

  const models = args.models.length ? args.models : CANDIDATE_MODELS;
  console.log(`Base URL: ${baseUrl}`);
  console.log(`待测模型: ${models.length} 个${args.vision ? "（含视觉读图验证）" : ""}`);
  console.log("");

  const results = [];
  for (const model of models) {
    const chat = await probe(baseUrl, key, model, false);
    results.push(chat);
    console.log(`${chat.ok ? "✅" : "❌"} ${model}  ${chat.ms}ms  ${chat.note}`);
    if (args.vision && chat.ok) {
      const seen = await probe(baseUrl, key, model, true);
      results.push(seen);
      console.log(`   ${seen.ok ? "✅ 可读图" : "❌ 读图失败"}  ${seen.ms}ms  ${seen.note}`);
    }
  }

  const working = results.filter((item) => item.ok && !item.vision).map((item) => item.model);
  const workingVision = results.filter((item) => item.ok && item.vision).map((item) => item.model);

  console.log("");
  if (!working.length) {
    console.log("没有可用的对话模型。先看上面的 ❌ 原因，通常是「未开通」或「未充值」。");
    process.exitCode = 1;
    return;
  }

  console.log("可用的对话模型：", working.join("、"));
  if (workingVision.length) console.log("可用的视觉模型：", workingVision.join("、"));
  else if (args.vision) console.log("视觉模型：本次没有测出可读图的模型，拍图讲错题需要再开通一个视觉模型。");

  const chatModel = working.find((item) => /vision|seed/i.test(item)) || working[0];
  const visionModel = workingVision[0] || working.find((item) => /vision|seed/i.test(item)) || chatModel;
  console.log("");
  console.log("据此可以往服务器 .env 里写：");
  console.log(`TUTOR_CHAT_API_KEY=${key.slice(0, 6)}…${key.slice(-4)}`);
  console.log(`TUTOR_CHAT_MODEL=${chatModel}`);
  console.log(`TUTOR_VISION_MODEL=${visionModel}`);
}

main().catch((error) => {
  console.error("自检脚本异常：", error?.message || error);
  process.exitCode = 1;
});
