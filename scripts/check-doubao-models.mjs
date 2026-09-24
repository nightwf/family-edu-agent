#!/usr/bin/env node
import zlib from "node:zlib";

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
 *
 * 三件事都要过，模型才算可用：
 *   1. 能对话（Key 有效、模型已开通、有余额）
 *   2. 能调工具（function calling）—— 私教运行时会给模型挂 30 个工具，
 *      不支持就会退化成"查不到孩子数据、只会空谈"，且不会报错，只在体验上体现
 *   3. 能读图（可选，拍图讲错题才需要）
 */

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// 控制台里显示的 Model ID 会随版本更新，这里只是常见候选（新在前，老版本大多已 Retiring）；
// 以「火山方舟 → 开通管理」页面上抄下来的 ID 为准（用 --models= 传进去最准）。
const CANDIDATE_MODELS = [
  "doubao-seed-2-1-pro-260915",
  "doubao-seed-2-1-lite-260915",
  "doubao-seed-2-1-turbo-260628",
  "doubao-seed-2-0-pro-260215",
  "doubao-seed-2-0-mini-260215",
  "doubao-seed-2-0-lite-260428",
  "doubao-seed-1-6-251015",
  "doubao-seed-1-6-flash-250828",
  "doubao-seed-1-6-vision-250815",
  "doubao-seed-1-6-250615",
  "doubao-1-5-vision-pro-32k-250115",
  "doubao-1-5-pro-32k-250115",
];

/**
 * 生成一张纯红色 PNG（16x16）作为视觉探针。
 *
 * 为什么不用 1x1：部分模型要求最小边 14 像素，1x1 会被判成
 * `InvalidParameter: Image dimensions are too small`，
 * 看起来像"不支持读图"，实际是探针不合法 —— 会误判掉能用的模型。
 *
 * 手写 PNG 是为了不引入依赖：签名 + IHDR + IDAT + IEND，
 * 每行前置一个过滤字节 0，CRC32 按规范算。
 */
function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** 纯红 16x16 PNG 的 base64（颜色固定，便于断言模型答"红"）。 */
function makeProbePng(size = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 颜色类型 2 = truecolor RGB
  // 10/11/12 默认 0（压缩/过滤/隔行）

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // 过滤类型：None
    for (let x = 0; x < size; x += 1) {
      row[1 + x * 3] = 0xd3; // R
      row[2 + x * 3] = 0x2f; // G
      row[3 + x * 3] = 0x2f; // B
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const PROBE_PNG = makeProbePng();

/** 探活用工具：形状与真实工具一致（对象参数 + 必填字段），只是不产生副作用。 */
const PROBE_TOOL = {
  type: "function",
  function: {
    name: "get_student_profile",
    description: "查询一个孩子的档案信息。",
    parameters: {
      type: "object",
      properties: {
        child_id: { type: "string", description: "孩子 ID" },
      },
      required: ["child_id"],
    },
  },
};

function parseArgs(argv) {
  const args = { key: "", baseUrl: "", models: [], vision: false, tools: true };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--key=")) args.key = raw.slice(6).trim();
    else if (raw.startsWith("--base-url=")) args.baseUrl = raw.slice(11).trim();
    else if (raw.startsWith("--models="))
      // 可以给多次 --models，累加而不是覆盖（调用方常要"对话模型 + 视觉模型"分开传）
      args.models.push(
        ...raw
          .slice(9)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    else if (raw === "--vision") args.vision = true;
    else if (raw === "--no-tools") args.tools = false;
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
  --no-tools         跳过工具调用验证（默认必测：私教靠工具读孩子数据）
`);
}

/** 把上游错误压成一句人话，便于定位是 Key、开通还是余额问题。 */
function explain(status, bodyText) {
  const body = (bodyText || "").slice(0, 300);
  const lower = body.toLowerCase();
  if (status === 401 || lower.includes("invalid api key") || lower.includes("authentication"))
    return "API Key 无效或填错（检查有没有多余空格、是不是方舟的 Key）";
  // 顺序重要：ModelNotOpen 与 InvalidEndpointOrModel.NotFound 都是 404，
  // 但前者是"账号没开通"、后者是"这个 ID 不存在"，指向完全不同的动作。
  if (lower.includes("modelnotopen") || lower.includes("not activated"))
    return "该模型未开通，去「火山方舟 → 开通管理」勾选它";
  if (lower.includes("invalidendpointormodel") || lower.includes("does not exist"))
    return "没有这个模型 ID（可能已下线或拼错），去「开通管理」页面抄现用 ID";
  if (lower.includes("overdue") || lower.includes("balance") || lower.includes("insufficient"))
    return "账户欠费或余额不足，需要充值（或免费额度已用完）";
  if (status === 429) return "触发限流/配额，稍后重试或检查模型的 RPM/TPM 限制";
  if (status === 403) return "无权限：多为未实名认证、未开通该模型，或 Key 没有该模型的访问权";
  if (status === 404) return "路径或模型不存在：确认 Base URL 是 /api/v3，模型 ID 拼写正确";
  if (status >= 500) return "上游服务异常，稍后重试";
  return "调用失败";
}

/** 从方舟错误体里摘出 message，用于把"探针不合法"和"不支持读图"区分开。 */
function extractMessage(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    return String(parsed?.error?.message || "").slice(0, 180);
  } catch {
    return "";
  }
}

async function probe(baseUrl, key, model, vision) {
  const content = vision
    ? [
        { type: "text", text: "这张图是什么颜色？只回一个字。" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PROBE_PNG}` } },
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
    // 视觉探针被拒时把上游原文带出来：否则"探针不合法"会被误读成"不支持读图"
    const detail = vision && /InvalidParameter/i.test(text) ? ` · ${extractMessage(text)}` : "";
    return { model, vision, ok: false, ms, note: `HTTP ${response.status} · ${explain(response.status, text)}${detail}` };
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

/**
 * 工具调用探活。这是私教能不能"看到孩子数据"的开关：
 * 挂上工具后模型应该主动发起 tool_call，而不是直接编一段回答。
 */
async function probeTools(baseUrl, key, model) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "请调用工具查询孩子 child-123 的档案，不要直接编答案。" }],
        tools: [PROBE_TOOL],
        tool_choice: "auto",
        max_tokens: 128,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "请求超时（30 秒）" : `网络不可达：${error?.message || error}`;
    return { model, vision: false, tool: true, ok: false, ms: Date.now() - started, note: reason };
  }

  const ms = Date.now() - started;
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      model,
      vision: false,
      tool: true,
      ok: false,
      ms,
      note: `HTTP ${response.status} · ${explain(response.status, text)}`,
    };
  }

  const payload = await response.json().catch(() => null);
  const calls = payload?.choices?.[0]?.message?.tool_calls || [];
  const call = calls[0];
  if (!call?.function?.name) {
    const said = String(payload?.choices?.[0]?.message?.content || "").trim().slice(0, 40);
    return {
      model,
      vision: false,
      tool: true,
      ok: false,
      ms,
      note: `不支持工具调用（直接回了文字：${said || "(空)"}）—— 这个模型不能给私教用`,
    };
  }

  let argsOk = true;
  try {
    const args = JSON.parse(call.function.arguments || "{}");
    argsOk = typeof args.child_id === "string" && args.child_id.length > 0;
  } catch {
    argsOk = false;
  }
  return {
    model,
    vision: false,
    tool: true,
    ok: argsOk,
    ms,
    note: argsOk
      ? `工具调用正常（${call.function.name} + 合法参数）`
      : `能调工具但参数不合法：${String(call.function.arguments).slice(0, 60)}`,
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
  console.log(`待测模型: ${models.length} 个（对话${args.tools ? " + 工具调用" : ""}${args.vision ? " + 读图" : ""}）`);
  console.log("");

  const results = [];
  for (const model of models) {
    const chat = await probe(baseUrl, key, model, false);
    results.push(chat);
    console.log(`${chat.ok ? "✅" : "❌"} ${model}  ${chat.ms}ms  ${chat.note}`);
    if (args.tools && chat.ok) {
      const tools = await probeTools(baseUrl, key, model);
      results.push(tools);
      console.log(`   ${tools.ok ? "✅ 可调工具" : "❌ 工具调用"}  ${tools.ms}ms  ${tools.note}`);
    }
    if (args.vision && chat.ok) {
      const seen = await probe(baseUrl, key, model, true);
      results.push(seen);
      console.log(`   ${seen.ok ? "✅ 可读图" : "❌ 读图失败"}  ${seen.ms}ms  ${seen.note}`);
    }
  }

  // 对话与工具是必要条件；缺工具的模型不能推给私教。
  const chatOk = results.filter((item) => item.ok && !item.vision && !item.tool).map((item) => item.model);
  const toolOk = results.filter((item) => item.ok && item.tool).map((item) => item.model);
  const working = args.tools ? chatOk.filter((item) => toolOk.includes(item)) : chatOk;
  const chatOnly = args.tools ? chatOk.filter((item) => !toolOk.includes(item)) : [];
  const workingVision = results.filter((item) => item.ok && item.vision).map((item) => item.model);

  console.log("");
  if (!working.length) {
    if (chatOnly.length) {
      console.log(`有能对话但**不支持工具调用**的模型：${chatOnly.join("、")}`);
      console.log("这类模型不能给私教用：它会查不到孩子数据、只能空谈，且不会报错。请换一个支持 function calling 的模型。");
    } else {
      console.log("没有可用的对话模型。先看上面的 ❌ 原因，通常是「未开通」或「未充值」。");
    }
    process.exitCode = 1;
    return;
  }

  console.log("可用（对话 + 工具调用）：", working.join("、"));
  if (chatOnly.length) console.log("仅能对话、不能调工具（不可用）：", chatOnly.join("、"));
  if (workingVision.length) console.log("可用的视觉模型：", workingVision.join("、"));
  else if (args.vision) console.log("视觉模型：本次没有测出可读图的模型，拍图讲错题需要再开通一个视觉模型。");

  const chatModel = working.find((item) => /seed/i.test(item)) || working[0];
  // 视觉模型只在"读图真的通过"时才写。
  // 之前的兜底会退回到对话模型，等于把一个读图失败的模型写进 TUTOR_VISION_MODEL，
  // 上线后表现就是"发图必失败"，而且看不出是配置问题。
  const visionModel = workingVision[0] || "";
  console.log("");
  console.log("据此可以往服务器 .env 里写：");
  console.log(`TUTOR_CHAT_API_KEY=${key.slice(0, 6)}…${key.slice(-4)}`);
  console.log(`TUTOR_CHAT_MODEL=${chatModel}`);
  if (visionModel) {
    console.log(`TUTOR_VISION_MODEL=${visionModel}`);
  } else {
    console.log("# TUTOR_VISION_MODEL 暂不写：没有验证通过的视觉模型，先只上文字对话");
  }
}

main().catch((error) => {
  console.error("自检脚本异常：", error?.message || error);
  process.exitCode = 1;
});
