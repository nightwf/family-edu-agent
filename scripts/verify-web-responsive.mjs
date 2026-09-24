/**
 * 校验电脑端 / 平板端 / 手机端的响应式布局。
 *
 * 作用：安卓客户端只是承载线上站点，所以手机与平板能不能用，
 * 取决于网页本身在窄屏下的表现。这里用真实浏览器渲染，
 * 接口用桩数据，避免碰生产数据。
 *
 * 用法：node scripts/verify-web-responsive.mjs [预览端口]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const liveUrlArg = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
const port = Number(process.argv[2] || 4199);
const baseUrl = liveUrlArg || `http://127.0.0.1:${port}/family-edu/`;
const outDir = path.join(process.cwd(), "designs");
fs.mkdirSync(outDir, { recursive: true });

// 桩数据故意让「数学」有记录、其余三科只有声明没有记录，
// 用来验证「声明的学科即使没数据也要展示」和「空数据用真实空状态」这两条要求。
const home = {
  children: [
    { id: "c1", name: "JOJO", age: 10, grade: "四年级", gender: "male", subjects: ["语文", "数学", "英语", "科学"], textbookVersion: "人教版" },
  ],
  active_child: { id: "c1", name: "JOJO", age: 10, grade: "四年级", gender: "male", subjects: ["语文", "数学", "英语", "科学"], textbookVersion: "人教版" },
  subject_overview: {
    child: { child_id: "c1", name: "JOJO", grade: "四年级" },
    overall: {
      conclusion: "整体需要关注，数学是目前最需要优先处理的一科",
      tags: ["3 个薄弱知识点", "1 项复测到期", "2 条待处理信号"],
      metrics: { subject_count: 1, mastery_average: 58, review_due_count: 1 },
    },
    subjects: [
      {
        subject: "数学", status: "focus", status_text: "需重点", mastery_score: 58,
        weak_count: 2, review_due_count: 1, attempts_7d: 3,
        change_text: "两步应用题重复出错 2 次，建议本周单独安排。",
      },
      { subject: "语文", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
      { subject: "英语", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
      { subject: "科学", status: "thin", status_text: "材料不足", mastery_score: null, weak_count: 0, review_due_count: 0, attempts_7d: 0, change_text: "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。" },
    ],
  },
  learning_priorities: {
    top: { label: "两步应用题", subject: "数学", reason: "同一题型两周内重复出错 2 次" },
    priorities: [{ label: "两步应用题", subject: "数学", reason: "同一题型两周内重复出错 2 次" }],
    signal_count: 2,
    planning_required: true,
  },
  planning_request: { id: "plan-1", status: "pending", trigger_reason: "数学出现重复错误，需要重新安排下一阶段重点" },
  child_state: {
    summary: { evidence_7d: 4, evidence_42d: 9, pending_confirmation: 1, confirmed: 6, corrected: 1 },
    recent_evidence: [],
    active_goal: null,
  },
  relationship: { status: "平稳", score: 78, communicationNote: "最近一周沟通顺畅。", conflictCount: 0 },
  wrong_questions: { items: [], total: 0 },
  mastery: { items: [], total: 0 },
  homework: [
    { id: "h1", childId: "c1", subject: "数学", title: "练习册 P12 应用题", dueDate: "2026-09-25T00:00:00.000Z", status: "pending" },
    { id: "h2", childId: "c1", subject: "语文", title: "朗读课文并复述", dueDate: "2026-09-26T00:00:00.000Z", status: "pending" },
  ],
  stats: { familyName: "验证家庭", childCount: 1, recordCount: 12, reportCount: 3, homeworkCount: 2 },
};

// 朗读桩：一段 1.5 秒的静音 WAV。真实 TTS 要密钥，这里只验证"前端能拿到可播放音频"。
const speechWav = (() => {
  const sampleRate = 8000;
  const seconds = 3;
  const samples = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + samples);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
})();
const speechWavBase64 = speechWav.toString("base64");

/** SSE 桩：一轮回答的文本 + 两句语音，用来验证"边到边念"和插话打断。 */
function tutorTurnSse() {
  const events = [
    ["text", { delta: "先读一遍题。" }],
    ["text", { delta: "再看看单位是什么。" }],
    ["done", { messageId: "msg-2", quotaLeft: 58, usage: { promptTokens: 4, completionTokens: 6 } }],
    ["speech_start", { total: 2 }],
    ["speech", { seq: 0, total: 2, format: "audio/wav", chunk: speechWavBase64 }],
    ["speech", { seq: 1, total: 2, format: "audio/wav", chunk: speechWavBase64 }],
    ["speech_end", { total: 2 }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** 记录这一轮桩接口被打了哪些关键请求（每个形态重置一次）。 */
const netProbe = {
  messagePosts: 0,
  interruptCalls: 0,
  conversationCreates: 0,
  transcribeCalls: 0,
  continuousTranscribeCalls: 0,
  speakFlags: [],
};

/**
 * 给 Chromium 喂一段可控的"麦克风输入"：说 0.7 秒、停 1.6 秒，循环 5 遍。
 * 用默认的假麦克风是一段连续音，永远等不到静音、断不了句，
 * 也就测不出"孩子说完了"和"私教念的时候孩子插话"这两件事。
 */
const fakeMicWav = (() => {
  const sampleRate = 48000;
  const cycles = 5;
  const toneMs = 700;
  const silenceMs = 1600;
  const totalSamples = Math.floor(((toneMs + silenceMs) * cycles * sampleRate) / 1000);
  const dataBytes = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < totalSamples; index += 1) {
    const ms = (index / sampleRate) * 1000;
    const inCycle = ms % (toneMs + silenceMs);
    const value = inCycle < toneMs ? Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.6 : 0;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
})();
const fakeMicPath = path.join(os.tmpdir(), "heya-fake-mic.wav");
if (!liveUrlArg) fs.writeFileSync(fakeMicPath, fakeMicWav);

/**
 * 一段 5 秒的纯静音，给"静默自动收工"那条用例当麦克风输入。
 * 默认的假麦克风一直在响，永远走不到"没人说话"，那条路径就验不了。
 */
const silentMicWav = (() => {
  const sampleRate = 48000;
  const samples = sampleRate * 5;
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
})();
const silentMicPath = path.join(os.tmpdir(), "heya-silent-mic.wav");
if (!liveUrlArg) fs.writeFileSync(silentMicPath, silentMicWav);

const stubs = [
  [/\/api\/home(\?|$)/, () => home],
  [
    /\/api\/mobile\/subject-detail(\?|$)/,
    () => ({
      child: { child_id: "c1" },
      subject: "数学",
      status: "focus",
      status_text: "需重点",
      mastery_score: 58,
      judgement: "数学整体掌握度 58 分，两步应用题重复出错，本周需要重点安排。",
      gaps: [{ name: "两步应用题", mastery_score: 52, type: "REPEATED_ERROR", why: "同一题型两周内重复出错 2 次", evidence: "练习 4 次 · 独立作答 2 次 · 覆盖 1 种变式" }],
      advice: { action: "先讲清两步之间的依赖关系，再做同型变式", method: "先示范一次，再让孩子独立复述步骤", pass_criteria: "连续 3 次独立做对且能说出中间量", retest: "24 小时后复测一次", basis: "题型掌握判定标准：独立作答 5 次、覆盖 3 种变式", estimated_minutes: 20 },
      tasks: [{ title: "练习册 P12 应用题", due_date: "2026-09-25T00:00:00.000Z", estimated_minutes: 15 }],
      planning_required: true,
    }),
  ],
  [/\/api\/settings(\?|$)/, () => ({ family: { name: "验证家庭", code: "123456" }, mcp_token: "stub-token", workbuddy_prompt: "示例提示词", doubao_prompt: "示例提示词" })],
  [/\/api\/policies(\?|$)/, () => []],
  [/\/api\/policy-changes(\?|$)/, () => []],
  [/\/api\/v2\/family\/policy(\?|$)/, () => ({})],
  [/\/api\/family\/memberships(\?|$)/, () => []],
  [/\/api\/education-settings(\?|$)/, () => ({})],
  [/\/api\/v2\/education-methods(\?|$)/, () => []],
  // 私教接口：只用于验证安卓端入口与聊天页骨架，不触发任何真实模型调用。
  [/\/api\/tutor\/status(\?|$)/, () => ({ enabled: true, ready: true, model_configured: true, quota: { message_limit: 60, used_messages: 0, left_messages: 60 } })],
  [/\/api\/tutor\/voice\/status(\?|$)/, () => ({ asr: true, tts: true, idle_ms: probeState.voiceIdleMs })],
  [
    /\/api\/tutor\/conversations\/[^/?]+\/messages(\?|$)/,
    () => ({
      messages: [
        { id: "msg-assistant-1", role: "assistant", content: "先别急着算。题目里的 45 是哪一步来的？", createdAt: "2026-09-24T02:00:00.000Z" },
      ],
    }),
  ],
  [
    /\/api\/tutor\/conversations(\?|$)/,
    () => ({ conversations: [{ id: "conv-1", childId: "c1", persona: "child_tutor", status: "active" }], conversation: { id: "conv-1", childId: "c1", persona: "child_tutor", status: "active" } }),
  ],
  [/\/api\/tutor\/quota(\?|$)/, () => ({ allowed: true, used_messages: 0, message_limit: 60, left_messages: 60 })],
];

/** 服务端下发的静默兜底时长。主用例给大值，免得验证过程里被自动收工打断。 */
const probeState = { voiceIdleMs: 180_000, continuousMode: false };

/**
 * 麦克风生命周期探针：把每次拿到的流留一份引用，事后能数出"还有几路在采音"。
 * 固定定位那套思路在这里不适用，只有真的数轨道才骗不了人。
 */
const MIC_PROBE_SCRIPT = () => {
  const streams = [];
  let trackStops = 0;
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await originalGetUserMedia(constraints);
    streams.push(stream);
    return stream;
  };
  const originalStop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function stop(...args) {
    trackStops += 1;
    return originalStop.apply(this, args);
  };
  window.__micProbe = () => ({
    liveAudioTracks: streams.reduce(
      (count, stream) => count + stream.getAudioTracks().filter((track) => track.readyState === "live").length,
      0,
    ),
    streamsOpened: streams.length,
    trackStops,
  });
};

/**
 * 盯住所有 <audio> 的播放与停止。
 *
 * "有没有出声"这件事光看界面看不出来：按钮变成"停止"只代表它打算放，
 * 不代表真的放了，也不代表后来真的停了。这里在原型上记一笔，
 * 判定改成"应用有没有真的发起播放 / 有没有真的掐断"，并且看 currentTime
 * 有没有往前走（证明那段 WAV 能解码、确实在放）。
 */
const AUDIO_PROBE_SCRIPT = () => {
  const probe = { plays: [], pauses: 0, live: 0, elements: [] };
  const mediaProto = HTMLMediaElement.prototype;
  const originalPlay = mediaProto.play;
  const originalPause = mediaProto.pause;
  mediaProto.play = function play(...args) {
    probe.plays.push(String(this.src || "").slice(0, 40));
    probe.live += 1;
    probe.elements.push(this);
    this.addEventListener("ended", () => {
      probe.live = Math.max(0, probe.live - 1);
    });
    return originalPlay.apply(this, args);
  };
  mediaProto.pause = function pause(...args) {
    if (!this.paused) probe.live = Math.max(0, probe.live - 1);
    probe.pauses += 1;
    return originalPause.apply(this, args);
  };
  window.__audioProbe = () => ({
    plays: probe.plays.length,
    pauses: probe.pauses,
    live: probe.live,
    // 已经放到第几秒：>0 说明解码器真的吐出了音频，不是"点了没响"
    maxTime: Math.max(0, ...probe.elements.map((element) => element.currentTime || 0)),
  });
};

const viewports = [
  { name: "pad-landscape", width: 1366, height: 940, expectSidebar: true },
  { name: "pad-portrait", width: 800, height: 1200, expectSidebar: false },
  { name: "phone", width: 393, height: 851, expectSidebar: false },
  // 安卓 APK 是 WebView 承载同一个站点，MainActivity 在 UA 里附加 HeYaAndroid/1.0。
  // 用同一个 UA 跑一遍，验证私教入口只在这个形态下出现、且聊天页在窄屏下不溢出。
  { name: "apk-webview", width: 393, height: 851, expectSidebar: false, apk: true },
  // 同一个 APK 也装在平板上（孩子用平板看的时候更多），所以宽屏也要跑一遍免提舞台，
  // 免得人物/音量条只在小屏上排得下。
  { name: "apk-tablet", width: 800, height: 1200, expectSidebar: false, apk: true },
];

// 本地起一个只读静态服务，把构建产物挂在 /family-edu/ 下（与线上路径一致）
const distDir = path.join(process.cwd(), "apps/web/dist");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  // 版本号是构建产出的 version.json，页面要 fetch 它
  ".json": "application/json; charset=utf-8",
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let relative = url.pathname.replace(/^\/family-edu\/?/, "");
  if (relative === "" || !path.extname(relative)) relative = "index.html";
  const filePath = path.join(distDir, relative);
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(response);
});
if (!liveUrlArg) {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

// 假麦克风让"连续对话"能在无人工干预下走通；自动播放放开是为了让朗读按钮点一次就出声。
const browser = await chromium.launch({
  channel: "chrome",
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(liveUrlArg ? [] : [`--use-file-for-fake-audio-capture=${fakeMicPath}`]),
    "--autoplay-policy=no-user-gesture-required",
  ],
});

/** 轮询等待一个条件成立，用于等前端真实触发的请求。 */
async function waitFor(condition, timeoutMs = 5000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return condition();
}

/**
 * 把一张截图丢进空白页，用 canvas 读出像素统计。
 *
 * 用途：几何探针只能证明"元素在那儿、尺寸不为零"，证明不了"画出来了"。
 * 人物图如果 404，盒子照样有宽高；底色如果没换，类名也照样在。
 * 所以关键的两处（舞台有没有真内容、换过底色后文字还读不读得清）落到像素上验。
 */
async function pixelStats(browser, pngBuffer, clip) {
  const page = await browser.newPage();
  await page.setContent("<canvas id='probe'></canvas>");
  const stats = await page.evaluate(
    async ({ base64, region }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.getElementById("probe");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const x = Math.max(0, Math.min(region.x, canvas.width - 1));
      const y = Math.max(0, Math.min(region.y, canvas.height - 1));
      const w = Math.max(1, Math.min(region.w, canvas.width - x));
      const h = Math.max(1, Math.min(region.h, canvas.height - y));
      const { data } = ctx.getImageData(x, y, w, h);
      let luminanceSum = 0;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let min = 255;
      let max = 0;
      const buckets = new Set();
      const total = w * h;
      for (let index = 0; index < data.length; index += 4) {
        const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        luminanceSum += luminance;
        redSum += red;
        greenSum += green;
        blueSum += blue;
        if (luminance < min) min = luminance;
        if (luminance > max) max = luminance;
        buckets.add(`${red >> 4},${green >> 4},${blue >> 4}`);
      }
      return {
        w,
        h,
        avgLuminance: Math.round(luminanceSum / total),
        luminanceRange: Math.round(max - min),
        avgRed: Math.round(redSum / total),
        avgGreen: Math.round(greenSum / total),
        avgBlue: Math.round(blueSum / total),
        distinctColors: buckets.size,
      };
    },
    { base64: pngBuffer.toString("base64"), region: clip },
  );
  await page.close();
  return stats;
}

const report = [];
try {
  for (const viewport of viewports) {
    netProbe.messagePosts = 0;
    netProbe.interruptCalls = 0;
    netProbe.conversationCreates = 0;
    netProbe.transcribeCalls = 0;
    netProbe.continuousTranscribeCalls = 0;
    netProbe.speakFlags = [];
    probeState.continuousMode = false;
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      ...(viewport.apk ? { permissions: ["microphone"] } : {}),
      ...(viewport.apk
        ? {
            userAgent:
              "Mozilla/5.0 (Linux; Android 14; V2312A Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HeYaAndroid/1.0",
          }
        : {}),
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 160)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 160));
    });

    if (liveUrlArg) console.log(`检查线上地址：${baseUrl}`);
    await page.route("**/api/**", async (route) => {
      if (liveUrlArg) {
        await route.continue();
        return;
      }
      const url = route.request().url();
      // 发消息：SSE 桩，含文本、语音片段与收尾，用来验证流式朗读
      if (/\/api\/tutor\/conversations\/[^/?]+\/messages(\?|$)/.test(url) && route.request().method() === "POST") {
        netProbe.messagePosts += 1;
        // 记下前端有没有让服务端合成语音：开关关掉时这里必须是 false，
        // 光看界面上不出声不算数——服务端还在合成就是在白烧配额。
        netProbe.speakFlags.push(route.request().postDataJSON?.()?.speak === true);
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: { "access-control-allow-origin": "*" },
          body: tutorTurnSse(),
        });
        return;
      }
      // 插话打断
      if (/\/api\/tutor\/conversations\/[^/?]+\/interrupt(\?|$)/.test(url)) {
        netProbe.interruptCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ interrupted: true }),
        });
        return;
      }
      // 建会话：用来验证浮窗「更多」里的「开新对话」真的接上了后端，不是个死按钮
      if (/\/api\/tutor\/conversations(\?|$)/.test(url) && route.request().method() === "POST") {
        netProbe.conversationCreates += 1;
      }
      // 朗读接口返回真音频字节，前端要能直接塞给 audio 播放
      if (/\/api\/tutor\/voice\/speak(\?|$)/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          headers: { "access-control-allow-origin": "*" },
          body: speechWav,
        });
        return;
      }
      // 实时对话里孩子说出的第一句会识别成文字，触发一轮真实回答；
      // 之后的话用来验证插话打断，不再重复发消息。
      // 注意"按住说话"也走同一个识别接口，所以这里要用"是否正在实时对话"
      // 来区分，否则按住说话的第一次识别会把这句话抢走，实时对话里就没词了。
      if (/\/api\/tutor\/voice\/transcribe(\?|$)/.test(url)) {
        netProbe.transcribeCalls += 1;
        const answerThis = probeState.continuousMode && netProbe.continuousTranscribeCalls === 0;
        if (probeState.continuousMode) netProbe.continuousTranscribeCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ text: answerThis ? "这道题我不会" : "" }),
        });
        return;
      }
      const match = stubs.find(([pattern]) => pattern.test(url));
      const body = match ? match[1]() : {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });

    // 线上检查用一个无效口令：接口会返回 401，但页面外壳（导航、顶栏）照常渲染，
    // 正好用来验证骨架在小屏下的表现，且不触碰任何真实家庭数据。
    await page.addInitScript(() => localStorage.setItem("familyEduToken", "responsive-check-token"));
    // 麦克风生命周期探针：把每次拿到的流留一份引用，事后能数出"还有几路在采音"。
    // 只在安卓形态下装：其他形态本来就不该碰麦克风。
    if (viewport.apk) {
      await page.addInitScript(MIC_PROBE_SCRIPT);
      // 实时对话里"系统在说话"靠 audio 元素确认，不是靠一个会变的按钮
      await page.addInitScript(AUDIO_PROBE_SCRIPT);
    }
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);

    const measure = async () => page.evaluate(() => {
      const sidebar = document.querySelector("aside");
      const nav = document.querySelector("header button[aria-label='打开导航']");
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        sidebarVisible: !!sidebar && sidebar.offsetParent !== null,
        hamburgerVisible: !!nav && nav.offsetParent !== null,
        title: document.querySelector("header div")?.textContent?.trim() || "",
      };
    });

    const before = await measure();

    // 首页信息结构与小程序对齐：整体状态 → 各学科情况 → 学习计划 → 最近学习任务。
    // 线上模式用的是无效口令，只能验证骨架，所以结构断言只在桩数据模式跑。
    let homeLayout = null;
    if (!liveUrlArg) {
      homeLayout = await page.evaluate(() => {
        const navButtons = [...document.querySelectorAll("aside nav button")];
        // 只看正文：侧边栏里也有「学习计划」这类字样，混进来会算错顺序
        const text = document.querySelector("main")?.innerText || "";
        const headingPos = (label) => text.indexOf(label);
        return {
          primaryNav: navButtons.filter((button) => button.querySelector("svg")).map((button) => button.textContent.trim()),
          secondaryNav: navButtons.filter((button) => !button.querySelector("svg")).map((button) => button.textContent.trim()),
          hasHero: !!document.querySelector('[data-testid="child-hero"]'),
          // 私教入口是设备形态开关：非安卓端不该出现在导航里
          tutorInNav: (document.querySelector("aside")?.innerText || "").includes("学习私教"),
          subjectCards: document.querySelectorAll('[data-testid="subject-card"]').length,
          subjectNamesOnCard: [...document.querySelectorAll('[data-testid="subject-card"]')].map((card) => card.textContent.trim().slice(0, 2)),
          declaredSubjectsShown: ["语文", "数学", "英语", "科学"].every((subject) => text.includes(subject)),
          order: {
            overall: headingPos("孩子整体状态"),
            subjects: headingPos("各学科情况"),
            planning: headingPos("学习计划"),
            tasks: headingPos("最近学习任务"),
          },
          emptyStateShown: text.includes("材料不足"),
          // 人物形象是绝对定位的，最容易压到文案或指标条，这里量真实几何位置
          hero: (() => {
            const hero = document.querySelector('[data-testid="child-hero"]');
            const image = hero?.querySelector("img");
            const title = hero?.querySelector("h2");
            const copy = title?.parentElement;
            const metrics = hero?.querySelector('[data-testid="child-hero-metrics"]');
            const rect = (el) => (el ? el.getBoundingClientRect() : null);
            const overlaps = (a, b) =>
              a && b ? !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) : null;
            return {
              heroBox: rect(hero) ? { w: Math.round(rect(hero).width), h: Math.round(rect(hero).height) } : null,
              imageBox: rect(image) ? { w: Math.round(rect(image).width), h: Math.round(rect(image).height) } : null,
              copyBox: rect(copy) ? { w: Math.round(rect(copy).width), h: Math.round(rect(copy).height) } : null,
              metricsBox: rect(metrics) ? { w: Math.round(rect(metrics).width), h: Math.round(rect(metrics).height) } : null,
              imageLoaded: image ? image.naturalWidth > 0 : false,
              imageInsideHero:
                rect(image) && rect(hero)
                  ? rect(image).right <= rect(hero).right + 1 && rect(image).bottom <= rect(hero).bottom + 1
                  : null,
              titleOverlapsImage: !overlaps(rect(title), rect(image)),
              imageOverlapsMetrics: overlaps(rect(image), rect(metrics)) === false,
            };
          })(),
        };
      });
      homeLayout.checks = {
        heroFirst:
          homeLayout.order.overall >= 0 &&
          homeLayout.order.overall < homeLayout.order.subjects &&
          homeLayout.order.subjects < homeLayout.order.planning &&
          homeLayout.order.subjects < homeLayout.order.tasks,
        allDeclaredSubjects: homeLayout.subjectCards === 4 && homeLayout.declaredSubjectsShown,
        honestEmptyState: homeLayout.emptyStateShown,
        tutorNavMatchesDevice: viewport.apk ? homeLayout.tutorInNav === true : homeLayout.tutorInNav === false,
        // 窄屏下侧边栏是收起来的抽屉，导航结构留到抽屉那块再核对
        fivePrimaryAreas: viewport.expectSidebar
          ? homeLayout.primaryNav.length === 9 && homeLayout.secondaryNav.length === 3
          : null,
        heroComposed:
          homeLayout.hero.imageLoaded &&
          homeLayout.hero.imageInsideHero === true &&
          homeLayout.hero.titleOverlapsImage === true &&
          homeLayout.hero.imageOverlapsMetrics === true,
      };
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-home.png`), fullPage: true });
    }

    // 二级页链路：学科卡片 → 后续规划建议；孩子状态 → 整体状态/原因/下一步
    let pageProbe = null;
    if (!liveUrlArg && viewport.expectSidebar) {
      await page.locator('[data-testid="subject-card"]').first().click();
      await page.waitForTimeout(400);
      const subjectPage = await page.evaluate(() => ({
        heading: document.querySelector("header div")?.textContent?.trim() || "",
        hasAdvice: document.body.innerText.includes("后续规划建议"),
        hasGaps: document.body.innerText.includes("需要先解决的问题"),
        hasJudgement: document.body.innerText.includes("整体掌握度"),
      }));
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-subject.png`), fullPage: true });

      await page.getByRole("button", { name: "孩子状态", exact: true }).first().click();
      await page.waitForTimeout(400);
      const statePage = await page.evaluate(() => {
        const text = document.querySelector("main")?.innerText || "";
        return {
          hasHero: !!document.querySelector('img[alt=""]'),
          steps: ["观察证据", "系统判断", "家长下一步"].map((label) => ({ label, at: text.indexOf(label) })),
          hasRelationship: text.includes("亲子关系状态"),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-child-state.png`), fullPage: true });

      pageProbe = {
        subjectPage,
        statePage,
        checks: {
          subjectDetailReached: subjectPage.hasAdvice && subjectPage.hasGaps && subjectPage.hasJudgement,
          stateStepsOrdered:
            statePage.steps.every((step) => step.at >= 0) &&
            statePage.steps[0].at < statePage.steps[1].at &&
            statePage.steps[1].at < statePage.steps[2].at,
          relationshipOnStatePage: statePage.hasRelationship,
        },
      };
      await page.getByRole("button", { name: "首页", exact: true }).first().click();
      await page.waitForTimeout(300);
    }

    // 私教入口：只在安卓 APK 形态下出现，且是一个浮窗（不是整页），
    // 点开要能聊天、浮窗里的滑动不能带着底下的页面一起动。
    let tutorProbe = null;
    if (viewport.apk) {
      // 入口是常驻浮标，不该藏在抽屉里；先确认它在首屏就能看到、且没跑出视口
      const bubble = page.locator('[data-testid="tutor-dock-bubble"]');
      const bubbleBox = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="tutor-dock-bubble"]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        // 固定定位元素的 offsetParent 永远是 null，可见性只能看几何 + 计算样式
        const style = getComputedStyle(el);
        return {
          visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          insideViewport:
            rect.left >= 0 &&
            rect.right <= window.innerWidth + 1 &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight + 1,
        };
      });

      const measureWindow = () =>
        page.evaluate(() => {
          const win = document.querySelector('[data-testid="tutor-dock-window"]');
          const rect = win?.getBoundingClientRect() || null;
          return {
            open: !!win,
            bubbleGone: !document.querySelector('[data-testid="tutor-dock-bubble"]'),
            size: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
            fitsViewport: rect
              ? rect.left >= -1 &&
                rect.right <= window.innerWidth + 1 &&
                rect.top >= -1 &&
                rect.bottom <= window.innerHeight + 1
              : false,
            bodyLocked: document.body.style.overflow === "hidden",
            pageStillOnHome: (document.querySelector("main")?.innerText || "").includes("孩子整体状态"),
          };
        });

      // 侧边栏那条入口也应该是打开浮窗，而不是切到另一个整页（页标题不变）
      await page.click("header button[aria-label='打开导航']");
      await page.waitForTimeout(400);
      const tutorNav = page.locator("aside nav button:visible", { hasText: "学习私教" }).first();
      const entryVisible = await tutorNav.isVisible();
      await tutorNav.click();
      await page.waitForTimeout(700);
      const fromNav = await measureWindow();
      const navTitle = await page.evaluate(() => document.querySelector("header div")?.textContent?.trim() || "");

      // 收起再点浮标打开，走一遍孩子最可能用的路径；关闭要二次确认
      await page.locator('[data-testid="tutor-dock-window"] button[aria-label="退出私教"]').first().click();
      await page.waitForTimeout(250);
      await page.locator('button[aria-label="确认退出"]').first().click();
      await page.waitForTimeout(400);
      const afterClose = await page.evaluate(() => ({
        windowGone: !document.querySelector('[data-testid="tutor-dock-window"]'),
        bubbleBack: !!document.querySelector('[data-testid="tutor-dock-bubble"]'),
        bodyUnlocked: document.body.style.overflow !== "hidden",
      }));
      await bubble.click();
      await page.waitForTimeout(700);
      const windowProbe = await measureWindow();

      // 浮窗打开时滑动，底下的页面不能跟着动。
      // 用真实滚轮事件：程序里的 window.scrollTo 对 overflow:hidden 的盒子照样有效，
      // 拿它当判据会得出错误结论，这里要的是"用户手动滑动时页面不动"。
      const readScroll = () =>
        page.evaluate(() => ({
          y: window.scrollY,
          mainTop: document.querySelector("main")?.scrollTop ?? null,
          documentScrollable: document.documentElement.scrollHeight > window.innerHeight,
        }));
      const scrollBefore = await readScroll();
      // 浮窗上方那条遮罩空白处
      await page.mouse.move(Math.round(viewport.width / 2), 18);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);
      const afterBackdropWheel = await readScroll();
      // 浮窗内部（消息列表自己该能滚）
      await page.mouse.move(Math.round(viewport.width / 2), Math.round(viewport.height * 0.55));
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(300);
      const afterSheetWheel = await readScroll();
      const scrollProbe = {
        scrollBefore,
        afterBackdropWheel,
        afterSheetWheel,
        backgroundMoved:
          afterBackdropWheel.y !== scrollBefore.y ||
          afterSheetWheel.y !== scrollBefore.y ||
          afterBackdropWheel.mainTop !== scrollBefore.mainTop ||
          afterSheetWheel.mainTop !== scrollBefore.mainTop,
      };

      const tutor = await page.evaluate(() => {
        const win = document.querySelector('[data-testid="tutor-dock-window"]');
        const composer = document.querySelector('textarea[placeholder="说说你卡在哪一步"]');
        const sendButton = document.querySelector('button[aria-label="发送"]');
        const rect = (el) => (el ? el.getBoundingClientRect() : null);
        const send = rect(sendButton);
        const speakButton = document.querySelector('button[aria-label="朗读这段"]');
        return {
          hasComposer: !!composer,
          hasSend: !!sendButton,
          hasMoreMenu: !!document.querySelector('button[aria-label="更多操作"]'),
          hasSpeakButton: !!speakButton,
          hasAutoReadToggle: !!document.querySelector('button[aria-label="开启自动朗读"], button[aria-label="关闭自动朗读"]'),
          hasContinuousToggle: !!document.querySelector(
            'button[aria-label="开启连续对话"], button[aria-label="关闭连续对话"]',
          ),
          hasHoldToTalk: !!document.querySelector('button[aria-label="按住说话"]'),
          // 语音工具条在窄屏上要能点得到：高度别低于移动端最小点击区，也不能出视口
          voiceToolbar: (() => {
            const buttons = [
              document.querySelector('button[aria-label="开启连续对话"], button[aria-label="关闭连续对话"]'),
              document.querySelector('button[aria-label="开启自动朗读"], button[aria-label="关闭自动朗读"]'),
            ].filter(Boolean);
            const rects = buttons.map((button) => button.getBoundingClientRect());
            return {
              count: buttons.length,
              minHeight: rects.length ? Math.round(Math.min(...rects.map((rect) => rect.height))) : 0,
              allInsideViewport: rects.every(
                (rect) => rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.top >= 0,
              ),
            };
          })(),
          // 发送键必须完整落在视口内，不能被裁掉
          sendInsideViewport: send ? send.left >= 0 && send.right <= window.innerWidth + 1 : false,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          emptyHint: (win?.innerText || "").includes("拍一张错题照片"),
          evidenceNote: (win?.innerText || "").includes("家长确认"),
        };
      });

      // 次要操作按移动端惯例收进「更多」：点开能看到、都点得动、
      // 而且真的接上了后端（点「开新对话」要打一次建会话请求）。
      await page.locator('button[aria-label="更多操作"]').click();
      await page.waitForTimeout(350);
      const menuProbe = await page.evaluate(() => {
        const menu = document.querySelector('[data-testid="tutor-dock-menu"]');
        const buttons = [...(menu?.querySelectorAll("button") || [])];
        const rect = menu?.getBoundingClientRect();
        return {
          open: !!menu,
          items: buttons.map((button) => button.textContent.trim()),
          allEnabled: buttons.length > 0 && buttons.every((button) => !button.disabled),
          rowsUsable: buttons.every((button) => button.getBoundingClientRect().height >= 40),
          insideViewport: rect
            ? rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1
            : false,
        };
      });
      const newConversation = page.locator('[data-testid="tutor-dock-menu"] button', { hasText: "开新对话" });
      if (await newConversation.count()) {
        await newConversation.first().click();
        await waitFor(() => netProbe.conversationCreates > 0, 3000);
      }
      const menuClosedAfterClick = await page.evaluate(() => !document.querySelector('[data-testid="tutor-dock-menu"]'));

      // 再开一次，按 Esc 只该收菜单，不该把整个对话窗口也关了
      await page.locator('button[aria-label="更多操作"]').click();
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const menuEscProbe = await page.evaluate(() => ({
        menuGone: !document.querySelector('[data-testid="tutor-dock-menu"]'),
        windowStillOpen: !!document.querySelector('[data-testid="tutor-dock-window"]'),
      }));

      // 朗读：点一次要真的出声（按钮切成"停止"），再点一次要能停下。
      let speakProbe = { started: false, stopped: false };
      const speakButton = page.locator('button[aria-label="朗读这段"]').first();
      if (await speakButton.count()) {
        await speakButton.click();
        speakProbe.started = await page
          .locator('button[aria-label="停止朗读"]')
          .first()
          .waitFor({ state: "visible", timeout: 4000 })
          .then(() => true)
          .catch(() => false);
        if (speakProbe.started) {
          await page.locator('button[aria-label="停止朗读"]').first().click();
          speakProbe.stopped = await page
            .locator('button[aria-label="朗读这段"]')
            .first()
            .waitFor({ state: "visible", timeout: 4000 })
            .then(() => true)
            .catch(() => false);
        }
      }

      // 连续对话：开着麦克风自己听，音量上来就该进入"听到了"状态。
      const continuousToggle = page.locator('button[aria-label="开启连续对话"]').first();
      const continuousProbe = { started: false, reachedSpeech: false, stopped: false, rowFits: true };

      // 浮窗开着、但没开连续对话时，麦克风必须是关的：
      // 打开聊天窗口本身不该采音，只有明确点了「连续对话」才开。
      const micIdle = await page.evaluate(() => window.__micProbe());

      // 自动朗读要做成"小开关"而不是又一个按钮：开关的语义是"这个选项开没开"，
      // 按钮的语义是"点一下执行一个动作"，屏幕上不该把两件事做成同一个样子。
      const readModeControls = await page.evaluate(() => {
        const autoRead =
          document.querySelector('button[aria-label="开启自动朗读"]') ||
          document.querySelector('button[aria-label="关闭自动朗读"]');
        const continuous = document.querySelector('button[aria-label="开启连续对话"]');
        const box = (el) => {
          const rect = el?.getBoundingClientRect();
          return rect ? { h: Math.round(rect.height), inside: rect.left >= 0 && rect.right <= window.innerWidth + 1 } : null;
        };
        return {
          autoReadRole: autoRead?.getAttribute("role") || "",
          autoReadChecked: autoRead?.getAttribute("aria-checked") ?? null,
          autoReadBox: box(autoRead),
          hasKnob: !!autoRead?.querySelector('span[aria-hidden="true"] span'),
          continuousIsSeparateButton: continuous?.tagName === "BUTTON" && !!continuous?.getAttribute("aria-pressed"),
          // 入口要求是"一个好看的语音图标，不需要文字说明"
          continuousHasNoText: (continuous?.textContent || "").trim() === "",
          continuousBox: box(continuous),
          // 没点入口前，实时对话整屏不该出现
          liveViewBefore: !document.querySelector('[data-testid="voice-live"]'),
        };
      });

      // 按住说话：按下才录、松手就停；按住期间被切后台（来电、锁屏）
      // 抬起事件不会再来，也必须自己停，否则麦克风会一直挂到 60 秒兜底。
      const holdProbe = { recording: false, afterRelease: 0, afterHide: 0 };
      const holdButton = page.locator('button[aria-label="按住说话"]').first();
      if (await holdButton.count()) {
        // 录音要先等 getUserMedia 回来，固定等某个毫秒数会时好时坏，
        // 这里改成轮询"麦克风有没有真的开起来"。
        const waitForTracks = async (expected, timeoutMs = 6000) => {
          const deadline = Date.now() + timeoutMs;
          let last = -1;
          while (Date.now() < deadline) {
            last = (await page.evaluate(() => window.__micProbe())).liveAudioTracks;
            if (expected(last)) return last;
            await page.waitForTimeout(120);
          }
          return last;
        };
        const box = await holdButton.boundingBox();
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        holdProbe.recording = (await waitForTracks((count) => count >= 1)) >= 1;
        await page.mouse.up();
        holdProbe.afterRelease = await waitForTracks((count) => count === 0);

        // 再按一次，这次按住不放，直接把页面置为不可见
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
        await waitForTracks((count) => count >= 1);
        holdProbe.afterHide = await page.evaluate(async () => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
          document.dispatchEvent(new Event("visibilitychange"));
          await new Promise((resolve) => setTimeout(resolve, 400));
          return window.__micProbe().liveAudioTracks;
        });
        await page.mouse.up();
        // 恢复成可见，免得后面几条用例都活在"后台"状态里
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
          Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }

      // 点一下 Siri 入口，整个窗口换成实时对话。
      if (await continuousToggle.count()) {
        probeState.continuousMode = true;
        await continuousToggle.click();
        continuousProbe.started = await page
          .locator('[data-testid="voice-live"]')
          .first()
          .waitFor({ state: "visible", timeout: 6000 })
          .then(() => true)
          .catch(() => false);
        // 假麦克风会先进入"在听"，说上话之后再进入"听到了，继续说"
        continuousProbe.reachedListening = await page
          .getByText("在听，直接说就行")
          .first()
          .waitFor({ state: "visible", timeout: 6000 })
          .then(() => true)
          .catch(() => false);
        continuousProbe.reachedSpeech = await page
          .getByText("听到了，继续说")
          .first()
          .waitFor({ state: "visible", timeout: 8000 })
          .then(() => true)
          .catch(() => false);
        // 整屏模式也不能让窄屏横向溢出
        continuousProbe.rowFits = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth <= 0,
        );

        // 实时对话这一屏长什么样：人物 + 光环 + 波纹 + 只读文字，没有输入框。
        continuousProbe.liveView = await page.evaluate(() => {
          const live = document.querySelector('[data-testid="voice-live"]');
          const transcript = document.querySelector('[data-testid="voice-transcript"]');
          const closeBtn = document.querySelector('button[aria-label="退出私教"]');
          const figure = live?.querySelector("img");
          const rect = (el) => (el ? el.getBoundingClientRect() : null);
          const close = rect(closeBtn);
          const figRect = rect(figure);
          const liveRect = rect(live);
          return {
            present: !!live,
            figureSrc: figure?.getAttribute("src") || "",
            figureBox: figRect ? { w: Math.round(figRect.width), h: Math.round(figRect.height) } : null,
            figureLoaded: !!figure && figure.complete && figure.naturalWidth > 0 && figure.naturalHeight > 0,
            figureAnim: figure ? getComputedStyle(figure).animationName : "",
            hasHalo: !!live?.querySelector(".voice-halo"),
            hasSpotlight: !!live?.querySelector(".voice-spotlight"),
            rings: live?.querySelectorAll(".voice-ring").length || 0,
            ripples: live?.querySelectorAll(".voice-ripple").length || 0,
            stateText: (live?.innerText || "").replace(/\s+/g, " ").trim(),
            hasTranscript: !!transcript,
            hasSwitchToText: !!live?.querySelector('button[aria-label="切换到文本对话"]'),
            transcriptText: (transcript?.innerText || "").trim(),
            // 这一屏不许有播放按钮，也不许有输入框
            transcriptHasPlayButton: !!transcript?.querySelector('button[aria-label="朗读这段"], button[aria-label="停止朗读"]'),
            hasAnyTextInput: !!live?.querySelector("textarea, input"),
            liveBox: liveRect
              ? { x: Math.round(liveRect.x), y: Math.round(liveRect.y), w: Math.round(liveRect.width), h: Math.round(liveRect.height) }
              : null,
            closeBox: close
              ? {
                  w: Math.round(close.width),
                  h: Math.round(close.height),
                  inside: close.left >= 0 && close.right <= window.innerWidth + 1 && close.top >= 0,
                }
              : null,
          };
        });
        await page.screenshot({ path: path.join(outDir, `voice-live-${viewport.name}.png`), fullPage: false });
      }

      // 实时对话背景按像素验一下：是沉浸式深绿，而不是一块白底。
      continuousProbe.pixels = null;
      if (continuousProbe.started) {
        const liveShot = await page.locator('[data-testid="voice-live"]').screenshot();
        continuousProbe.pixels = {
          live: await pixelStats(browser, liveShot, { x: 6, y: 6, w: 90, h: 64 }),
        };
      }
      // 连续对话期间麦克风是持续开着的（这是插话打断的前提）
      const micListening = await page.evaluate(() => window.__micProbe());

      // 孩子说出的第一句被识别成文字，自动发出去；答案边生成边流进实时文字。
      const streamProbe = { sent: false, userShown: false, playing: false };
      streamProbe.userShown = await page
        .locator('[data-testid="voice-transcript"]', { hasText: "这道题我不会" })
        .first()
        .waitFor({ state: "visible", timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      streamProbe.sent = await page
        .locator('[data-testid="voice-transcript"]', { hasText: "先读一遍题" })
        .first()
        .waitFor({ state: "visible", timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      // 答案已经流进实时文字了，再验一遍这一屏"只读对话"的约束：
      // 有文字、没有播放按钮、也没有输入框。
      continuousProbe.transcript = await page.evaluate(() => {
        const live = document.querySelector('[data-testid="voice-live"]');
        const transcript = document.querySelector('[data-testid="voice-transcript"]');
        return {
          present: !!transcript,
          text: (transcript?.innerText || "").trim(),
          hasPlayButton: !!transcript?.querySelector(
            'button[aria-label="朗读这段"], button[aria-label="停止朗读"]',
          ),
          hasAnyInput: !!live?.querySelector("textarea, input"),
        };
      });
      // 私教真的在念：audio 元素活着，不是按钮变了个颜色
      streamProbe.playing = await page
        .waitForFunction(() => window.__audioProbe().live >= 1, null, { timeout: 12_000 })
        .then(() => true)
        .catch(() => false);

      // 插话打断：私教念着的时候孩子又开口，本地停嘴 + 服务端停止生成。
      const bargeProbe = { interruptCalls: 0, audioStopped: false };
      if (streamProbe.playing) {
        await waitFor(() => netProbe.interruptCalls > 0, 12000);
        bargeProbe.interruptCalls = netProbe.interruptCalls;
        bargeProbe.audioStopped = await page
          .waitForFunction(() => window.__audioProbe().live === 0, null, { timeout: 6000 })
          .then(() => true)
          .catch(() => false);
      }

      // 退出实时对话：点"切换到文本对话"要能回到普通对话，麦克风也要还回去。
      if (await page.locator('button[aria-label="切换到文本对话"]').first().count()) {
        await page.locator('button[aria-label="切换到文本对话"]').first().click();
        continuousProbe.stopped = await page
          .locator('button[aria-label="开启连续对话"]')
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        continuousProbe.exited = await page.evaluate(
          () => !document.querySelector('[data-testid="voice-live"]'),
        );
      }

      // 关掉实时对话，麦克风要立刻还回去，不能留一路在采音
      await page.waitForTimeout(400);
      const micAfterStop = await page.evaluate(() => window.__micProbe());

      // 再开一次，验证"手机切到后台"这条路径：页面不可见了还在采音，
      // 就是家长会看到麦克风指示灯一直亮、也真的在被录。
      if (await page.locator('button[aria-label="开启连续对话"]').first().count()) {
        await page.locator('button[aria-label="开启连续对话"]').first().click();
        await page.waitForTimeout(700);
      }
      const micAfterHide = await page.evaluate(async () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
        await new Promise((resolve) => setTimeout(resolve, 400));
        return window.__micProbe();
      });

      // 收起浮窗要二次确认：点关闭 → 弹确认 → 点"再想想"不退出 →
      // 再点关闭 → 点"退出"才真的关，同时麦克风必须彻底释放。
      const closeConfirmProbe = { shown: false, cancelKeepsOpen: false, cancelClearsDialog: false, exited: false };
      await page.locator('[data-testid="tutor-dock-window"] button[aria-label="退出私教"]').first().click();
      await page.waitForTimeout(250);
      closeConfirmProbe.shown = (await page.locator('[data-testid="tutor-exit-confirm"]').count()) > 0;
      await page.locator('[data-testid="tutor-exit-confirm"] button', { hasText: "再想想" }).first().click();
      await page.waitForTimeout(250);
      closeConfirmProbe.cancelKeepsOpen = (await page.locator('[data-testid="tutor-dock-window"]').count()) > 0;
      closeConfirmProbe.cancelClearsDialog = (await page.locator('[data-testid="tutor-exit-confirm"]').count()) === 0;
      await page.locator('[data-testid="tutor-dock-window"] button[aria-label="退出私教"]').first().click();
      await page.waitForTimeout(250);
      await page.locator('button[aria-label="确认退出"]').first().click();
      await page.waitForTimeout(500);
      closeConfirmProbe.exited = (await page.locator('[data-testid="tutor-dock-window"]').count()) === 0;
      const micAfterClose = await page.evaluate(() => window.__micProbe());

      // 浮窗开着的时候底下的导航够不着（遮罩拦住），所以手机上不存在
      // "一边听着一边切到别的页面"这条路径。这里把它验出来，免得留个想当然的漏洞。
      await bubble.click();
      await page.waitForTimeout(600);
      const navBlockedWhileOpen = await page.evaluate(() => {
        const target = document.querySelector("header button[aria-label='打开导航']");
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return !(hit === target || target.contains(hit));
      });

      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-tutor.png`), fullPage: true });
      tutorProbe = {
        ...tutor,
        entryVisible,
        bubbleBox,
        fromNav,
        navTitle,
        windowProbe,
        scrollProbe,
        afterClose,
        menuProbe,
        menuClosedAfterClick,
        menuEscProbe,
        speakProbe,
        continuousProbe,
        micProbe: { idle: micIdle, listening: micListening, afterStop: micAfterStop, afterHide: micAfterHide, afterClose: micAfterClose },
        holdProbe,
        navBlockedWhileOpen,
        streamProbe,
        bargeProbe,
        closeConfirmProbe,
        net: {
          messagePosts: netProbe.messagePosts,
          transcribeCalls: netProbe.transcribeCalls,
          interruptCalls: netProbe.interruptCalls,
        },
        checks: {
          entryOnlyOnApk: entryVisible,
          // 常驻浮标：首屏可见、大小够点、完整在视口内
          bubbleUsable:
            bubbleBox?.visible === true && bubbleBox.width >= 44 && bubbleBox.height >= 44 && bubbleBox.insideViewport,
          // 两个入口打开的都是浮窗，不是跳走一个整页
          opensAsDock: windowProbe.open && fromNav.open && windowProbe.bubbleGone && navTitle === "首页",
          // 浮标点的这一下不离开当前页：底下的首页还在
          staysOnPage: windowProbe.pageStillOnHome,
          // 浮窗要完整落在视口里，并且不横向撑破
          windowFits: windowProbe.fitsViewport && tutor.overflowX <= 0,
          // 浮窗里滑动，底下的页面不动
          backgroundScrollLocked: windowProbe.bodyLocked && !scrollProbe.backgroundMoved,
          closesCleanly: afterClose.windowGone && afterClose.bubbleBack && afterClose.bodyUnlocked,
          chatReachable: tutor.hasComposer && tutor.hasSend,
          composerFits: tutor.sendInsideViewport && tutor.overflowX <= 0,
          // 次要操作在「更多」里：条目齐全、点得动、并且在视口内
          secondaryActionsInMenu:
            tutor.hasMoreMenu &&
            menuProbe.open &&
            menuProbe.items.join("|") === "记录这次情况|打印讲义|开新对话" &&
            menuProbe.allEnabled &&
            menuProbe.rowsUsable &&
            menuProbe.insideViewport,
          // 菜单里的操作真的接上后端：点「开新对话」会建一条会话
          menuActionsWired: menuClosedAfterClick && netProbe.conversationCreates > 0,
          // Esc 收菜单不误关窗口
          escClosesMenuOnly: menuEscProbe.menuGone && menuEscProbe.windowStillOpen,
          honestEvidenceBoundary: tutor.evidenceNote,
          voiceControlsPresent:
            tutor.hasHoldToTalk && tutor.hasAutoReadToggle && tutor.hasContinuousToggle && tutor.hasSpeakButton,
          readAloudWorks: speakProbe.started && speakProbe.stopped,
          continuousListeningWorks:
            continuousProbe.started &&
            continuousProbe.reachedListening &&
            continuousProbe.reachedSpeech &&
            continuousProbe.stopped,
          voiceRowFits: continuousProbe.rowFits,
          // 自动朗读是"开关"语义：role=switch + aria-checked + 看得见的滑块。
          // 屏幕上一个开/关选项和一个"点一下执行一次"的动作长一样，家长就分不清了。
          autoReadIsSwitch:
            readModeControls.autoReadRole === "switch" &&
            readModeControls.autoReadChecked !== null &&
            readModeControls.hasKnob &&
            (readModeControls.autoReadBox?.h ?? 0) >= 24 &&
            readModeControls.autoReadBox?.inside === true,
          // 连续对话是独立按钮，不和开关挤成一段文字；入口是图标，不带文字说明
          continuousIsOwnButton:
            readModeControls.continuousIsSeparateButton &&
            (readModeControls.continuousBox?.h ?? 0) >= 40 &&
            readModeControls.continuousBox?.inside === true,
          continuousIsIconOnly: readModeControls.continuousHasNoText,
          // 没点入口前，实时对话整屏不该出现
          stageOnlyWhenContinuous: readModeControls.liveViewBefore === true,
          // 实时对话：人物真的画出来、带光环和追光、还带呼吸/点头动画
          voiceLivePresent:
            continuousProbe.liveView?.present === true &&
            (continuousProbe.liveView.figureBox?.w ?? 0) > 0 &&
            (continuousProbe.liveView.figureBox?.h ?? 0) > 0 &&
            (continuousProbe.liveView.figureSrc || "").includes("brand/child-") &&
            continuousProbe.liveView.figureLoaded === true &&
            continuousProbe.liveView.figureAnim !== "none" &&
            continuousProbe.liveView.hasHalo === true &&
            continuousProbe.liveView.hasSpotlight === true,
          // 孩子在说话：光圈扩散 + 人物下面出现水波纹
          voiceLiveReactive:
            (continuousProbe.liveView?.rings ?? 0) >= 2 &&
            (continuousProbe.liveView?.ripples ?? 0) >= 3,
          voiceLiveStateCopy: (continuousProbe.liveView?.stateText || "").includes("听到了，继续说"),
          // 实时文字：孩子这句和私教答案都出现了，且这一屏没有播放按钮、没有输入框
          voiceTranscriptIsReadOnly:
            continuousProbe.transcript?.present === true &&
            (continuousProbe.transcript?.text || "").includes("这道题我不会") &&
            (continuousProbe.transcript?.text || "").includes("先读一遍题") &&
            continuousProbe.transcript?.hasPlayButton === false &&
            continuousProbe.transcript?.hasAnyInput === false,
          // 落在像素上：这一屏是沉浸式深绿，不是一块白底
          voiceLiveBackgroundIsDark: (continuousProbe.pixels?.live?.avgLuminance ?? 255) <= 160,
          // 小叉能点到，也能真的退回普通对话
          voiceLiveCloseUsable:
            (continuousProbe.liveView?.closeBox?.w ?? 0) >= 32 &&
            (continuousProbe.liveView?.closeBox?.h ?? 0) >= 32 &&
            continuousProbe.liveView?.closeBox?.inside === true,
          voiceLiveHasSwitchToText: continuousProbe.liveView?.hasSwitchToText === true,
          voiceLiveExits: continuousProbe.stopped === true && continuousProbe.exited === true,
          // 两个页面都有关闭按钮，点一下先弹确认，不是直接关
          closeNeedsConfirm: closeConfirmProbe.shown === true,
          closeConfirmCancels: closeConfirmProbe.cancelKeepsOpen === true && closeConfirmProbe.cancelClearsDialog === true,
          closeConfirmExits: closeConfirmProbe.exited === true,
          // 麦克风只在"真的在连续对话"时开着，别的时候必须一路都不留
          micSilentUntilAsked: micIdle.liveAudioTracks === 0,
          micOpenWhileListening: micListening.liveAudioTracks >= 1,
          micReleasedOnToggleOff: micAfterStop.liveAudioTracks === 0,
          // 切到后台还要继续采音，等于孩子把 App 放兜里也在被录
          micReleasedWhenHidden: micAfterHide.liveAudioTracks === 0,
          micReleasedOnClose: micAfterClose.liveAudioTracks === 0,
          holdToTalkReleases: holdProbe.recording && holdProbe.afterRelease === 0 && holdProbe.afterHide === 0,
          voiceToolbarUsable:
            tutor.voiceToolbar.count === 2 && tutor.voiceToolbar.minHeight >= 28 && tutor.voiceToolbar.allInsideViewport,
          // 文本先出现，语音片段随后边到边念
          streamedSpeechWorks: streamProbe.userShown && streamProbe.sent && streamProbe.playing && netProbe.messagePosts === 1,
          // 孩子插话：本地停嘴 + 服务端停止生成
          bargeInWorks: bargeProbe.interruptCalls > 0 && bargeProbe.audioStopped,
        },
      };
      await page.keyboard.press("Escape").catch(() => {});
    }

    await page.screenshot({ path: path.join(outDir, `web-${viewport.name}.png`), fullPage: false });

    // 下拉不刷新：页面里要挡掉浏览器的"下拉刷新"，但页面自己的滚动必须照常。
    // 只加 CSS 不验证，很容易连正常滚动一起弄坏，所以这里两头都测。
    const overscroll = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const htmlStyle = getComputedStyle(document.documentElement);
      return { body: style.overscrollBehaviorY, html: htmlStyle.overscrollBehaviorY };
    });
    const scrollGuard = await page.evaluate(async () => {
      const read = () => ({
        y: Math.round(window.scrollY),
        mainTop: Math.round(document.querySelector("main")?.scrollTop ?? 0),
      });
      const before = read();
      // 程序里的滚动只用来判断"还能不能滚"，真机上是手指滑动
      window.scrollTo(0, 400);
      document.querySelector("main")?.scrollTo(0, 400);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const after = read();
      window.scrollTo(0, before.y);
      document.querySelector("main")?.scrollTo(0, before.mainTop);
      const scrollable = document.documentElement.scrollHeight > window.innerHeight + 4;
      return {
        moved: after.y > before.y || after.mainTop > before.mainTop,
        scrollable,
      };
    });
    const pullDown = {
      blocked: overscroll.body === "contain" && overscroll.html === "contain",
      scrollingStillWorks: !scrollGuard.scrollable || scrollGuard.moved,
    };

    let drawer = null;
    if (!viewport.expectSidebar) {
      await page.click("header button[aria-label='打开导航']");
      await page.waitForTimeout(450);
      drawer = await page.evaluate(() => {
        const nav = [...document.querySelectorAll("aside nav button")].filter((el) => el.offsetParent !== null);
        return {
          drawerNavItems: nav.length,
          bodyOverflow: document.body.style.overflow,
          primaryNav: nav.filter((el) => el.querySelector("svg")).map((el) => el.textContent.trim()),
          secondaryNav: nav.filter((el) => !el.querySelector("svg")).map((el) => el.textContent.trim()),
          firstItems: nav.slice(0, 4).map((el) => el.textContent.trim()),
        };
      });
      await page.screenshot({ path: path.join(outDir, `web-${viewport.name}-drawer.png`), fullPage: false });
    }

    report.push({ viewport: viewport.name, ...before, homeLayout, pageProbe, tutorProbe, pullDown, drawer, errors: [...new Set(errors)].slice(0, 4) });
    await context.close();
  }

  /**
   * 静默自动收工单独跑一遍：真实兜底是 3 分钟，这里让服务端下发 2.5 秒，
   * 并换上一路完全静音的麦克风 —— 默认假麦克风一直在响，永远走不到"没人说话"。
   *
   * 这条用例要证明的是：孩子点了免提就去干别的，麦克风不会一直开着。
   */
  if (!liveUrlArg) {
    probeState.voiceIdleMs = 2500;
    // 换一个浏览器实例：麦克风输入是启动参数，跑起来之后换不了。
    // 这次喂的是纯静音文件，模拟"孩子点了免提就走开了"。
    const idleBrowser = await chromium.launch({
      channel: "chrome",
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${silentMicPath}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const idleContext = await idleBrowser.newContext({
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 2,
      permissions: ["microphone"],
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; V2312A Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HeYaAndroid/1.0",
    });
    const idlePage = await idleContext.newPage();
    const idleErrors = [];
    idlePage.on("pageerror", (error) => idleErrors.push(String(error.message).slice(0, 160)));
    idlePage.on("console", (message) => {
      if (message.type() === "error") idleErrors.push(message.text().slice(0, 160));
    });
    await idlePage.route("**/api/**", async (route) => {
      const url = route.request().url();
      const match = stubs.find(([pattern]) => pattern.test(url));
      const body = match ? match[1]() : {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });
    });
    await idlePage.addInitScript(() => localStorage.setItem("familyEduToken", "responsive-check-token"));
    await idlePage.addInitScript(MIC_PROBE_SCRIPT);
    await idlePage.goto(baseUrl, { waitUntil: "networkidle" });
    await idlePage.waitForTimeout(800);

    await idlePage.locator('[data-testid="tutor-dock-bubble"]').click();
    await idlePage.waitForTimeout(700);

    const idleProbe = { enabled: false, micWhileListening: 0, micAfterIdle: null, switchBack: false, noticeShown: false };
    const idleToggle = idlePage.locator('button[aria-label="开启连续对话"]').first();
    if (await idleToggle.count()) {
      await idleToggle.click();
      await idlePage.waitForTimeout(900);
      idleProbe.enabled = await idlePage
        .locator('[data-testid="voice-live"]')
        .first()
        .isVisible()
        .catch(() => false);
      idleProbe.micWhileListening = (await idlePage.evaluate(() => window.__micProbe())).liveAudioTracks;

      // 静音上限是 2.5 秒，等它过去；轮询到麦克风被放掉为止
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const probe = await idlePage.evaluate(() => window.__micProbe());
        if (probe.liveAudioTracks === 0) break;
        await idlePage.waitForTimeout(250);
      }
      idleProbe.micAfterIdle = await idlePage.evaluate(() => window.__micProbe());
      idleProbe.switchBack = await idlePage
        .locator('button[aria-label="开启连续对话"]')
        .first()
        .isVisible()
        .catch(() => false);
      idleProbe.noticeShown = (await idlePage.locator("body").innerText()).includes("连续对话先关上了");
    }

    await idlePage.screenshot({ path: path.join(outDir, "web-apk-webview-idle.png"), fullPage: false });
    report.push({
      viewport: "apk-idle-timeout",
      idleProbe,
      checks: {
        idleEnabled: idleProbe.enabled && idleProbe.micWhileListening >= 1,
        micReleasedAfterIdle: idleProbe.micAfterIdle?.liveAudioTracks === 0,
        switchBackToOff: idleProbe.switchBack,
        // 得告诉孩子为什么麦克风自己关了，不然会以为坏了
        tellsChildWhy: idleProbe.noticeShown,
      },
      errors: [...new Set(idleErrors)].slice(0, 4),
    });
    await idleContext.close();
    await idleBrowser.close();
  }

  /**
   * 朗读开关和"打断"单独跑一遍。
   *
   * 两件事要在真实浏览器里验，光读代码看不出来：
   * 1) 开关关掉之后必须一直是关的。浮窗一关，对话组件就整个卸载了，
   *    只把开关放在组件里的话，下次打开它又自己开始念——这就是"关了还在自动朗读"。
   * 2) 孩子一动手（按录音、发新问题），正在念的声音要立刻停，而且不能自己接上；
   *    但新问题该念还得念，否则开关就成了摆设。
   */
  if (!liveUrlArg) {
    const speechBrowser = await chromium.launch({
      channel: "chrome",
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const speechContext = await speechBrowser.newContext({
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 2,
      permissions: ["microphone"],
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; V2312A Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HeYaAndroid/1.0",
    });
    const speechPage = await speechContext.newPage();
    const speechErrors = [];
    speechPage.on("pageerror", (error) => speechErrors.push(String(error.message).slice(0, 160)));
    speechPage.on("console", (message) => {
      if (message.type() === "error") speechErrors.push(message.text().slice(0, 160));
    });

    // 记下每一轮"前端有没有让服务端合成语音"：开关关掉时必须是 false。
    // 只在界面上不出声不算数——服务端还在合成就是在白烧孩子的语音配额。
    const speechNet = { speakFlags: [] };
    await speechPage.route("**/api/**", async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (/\/api\/tutor\/conversations\/[^/?]+\/messages(\?|$)/.test(url) && method === "POST") {
        speechNet.speakFlags.push(route.request().postDataJSON?.()?.speak === true);
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream; charset=utf-8",
          headers: { "access-control-allow-origin": "*" },
          body: tutorTurnSse(),
        });
        return;
      }
      if (/\/api\/tutor\/voice\/speak(\?|$)/.test(url)) {
        await route.fulfill({ status: 200, contentType: "audio/wav", body: speechWav });
        return;
      }
      const match = stubs.find(([pattern]) => pattern.test(url));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(match ? match[1]() : {}),
      });
    });
    await speechPage.addInitScript(() => localStorage.setItem("familyEduToken", "responsive-check-token"));
    await speechPage.addInitScript(AUDIO_PROBE_SCRIPT);
    await speechPage.goto(baseUrl, { waitUntil: "networkidle" });
    await speechPage.waitForTimeout(800);

    const openTutor = async () => {
      await speechPage.locator('[data-testid="tutor-dock-bubble"]').click();
      await speechPage.locator('[data-testid="tutor-dock-window"]').waitFor({ state: "visible", timeout: 6000 });
      // 会话要建好才能发消息，等输入框和发送键就位
      await speechPage.locator('button[aria-label="发送"]').first().waitFor({ state: "visible", timeout: 8000 });
      await speechPage.waitForTimeout(300);
    };
    const closeTutor = async () => {
      await speechPage.locator('[data-testid="tutor-dock-window"] button[aria-label="退出私教"]').first().click();
      await speechPage.waitForTimeout(250);
      await speechPage.locator('button[aria-label="确认退出"]').first().click();
      await speechPage.waitForTimeout(500);
    };
    const autoReadSwitch = () =>
      speechPage.locator('[data-testid="tutor-dock-window"] button[role="switch"]').first();
    const audio = () => speechPage.evaluate(() => window.__audioProbe());
    /** 这一轮回答是否已经收尾（发送键回来 = 不再 busy） */
    const sendMessage = async (text) => {
      await speechPage.locator('textarea[placeholder="说说你卡在哪一步"]').first().fill(text);
      await speechPage.locator('button[aria-label="发送"]').first().click();
      await speechPage.locator('button[aria-label="发送"]').first().waitFor({ state: "visible", timeout: 8000 });
      await speechPage.waitForTimeout(250);
    };
    const waitForPlays = async (target, timeoutMs = 12_000) => {
      const deadline = Date.now() + timeoutMs;
      let last = await audio();
      while (Date.now() < deadline) {
        if (last.plays >= target) return last;
        await speechPage.waitForTimeout(200);
        last = await audio();
      }
      return last;
    };

    const speechProbe = {
      defaultOn: false,
      afterClickOff: false,
      stillOffAfterReopen: false,
      stillOffAfterReload: false,
      silentTurn: null,
      spokenTurn: null,
      cutByRecording: null,
      cutByNewQuestion: null,
    };

    await openTutor();
    speechProbe.defaultOn = (await autoReadSwitch().getAttribute("aria-checked")) === "true";

    // 关掉开关 —— 这就是家长做的那一下
    await autoReadSwitch().click();
    await speechPage.waitForTimeout(300);
    speechProbe.afterClickOff = (await autoReadSwitch().getAttribute("aria-checked")) === "false";

    // 关掉浮窗再打开：以前这里会回到"开"，也就是家长看到的"关了还在自动朗读"
    await closeTutor();
    await openTutor();
    speechProbe.stillOffAfterReopen = (await autoReadSwitch().getAttribute("aria-checked")) === "false";

    // 再刷新整个页面：偏好得是存下来的，不是这一次会话的运气
    await speechPage.reload({ waitUntil: "networkidle" });
    await speechPage.waitForTimeout(800);
    await openTutor();
    speechProbe.stillOffAfterReload = (await autoReadSwitch().getAttribute("aria-checked")) === "false";

    // 开关是关的：这一轮不许出声，也不许让服务端去合成
    const silentBefore = await audio();
    await sendMessage("开关关着，别念");
    await speechPage.waitForTimeout(1200);
    const silentAfter = await audio();
    speechProbe.silentTurn = {
      speakFlag: speechNet.speakFlags.at(-1),
      playsDelta: silentAfter.plays - silentBefore.plays,
    };

    // 打开开关：这一轮要念，而且真的在走时间（不是"点了没响"）
    await autoReadSwitch().click();
    await speechPage.waitForTimeout(300);
    const spokenBefore = await audio();
    await sendMessage("开关开着，念给我听");
    const spokenTurn = await waitForPlays(spokenBefore.plays + 2);
    speechProbe.spokenTurn = {
      speakFlag: speechNet.speakFlags.at(-1),
      playsDelta: spokenTurn.plays - spokenBefore.plays,
      live: spokenTurn.live,
      maxTime: Number(spokenTurn.maxTime.toFixed(2)),
    };

    // 孩子按下录音：声音要当场停，而且排队里那半句不能再放出来
    const playsBeforeHold = (await audio()).plays;
    const holdButton = speechPage.locator('button[aria-label="按住说话"]').first();
    const holdBox = await holdButton.boundingBox();
    await speechPage.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
    await speechPage.mouse.down();
    await speechPage.waitForTimeout(600);
    const duringHold = await audio();
    await speechPage.mouse.up();
    await speechPage.waitForTimeout(1500);
    const afterHold = await audio();
    speechProbe.cutByRecording = {
      liveDuringHold: duringHold.live,
      paused: duringHold.pauses > spokenBefore.pauses,
      playsWhileHeld: duringHold.plays - playsBeforeHold,
      playsAfterRelease: afterHold.plays - playsBeforeHold,
      liveAfterRelease: afterHold.live,
    };

    // 问新问题：上一轮没念完的先停，新问题照样念
    await sendMessage("那这道题再讲一遍");
    const midTurn = await waitForPlays(playsBeforeHold + 2);
    await sendMessage("等一下，先换个问题");
    const newTurn = await waitForPlays(playsBeforeHold + 4);
    speechProbe.cutByNewQuestion = {
      playsForFirstTurn: midTurn.plays - playsBeforeHold,
      playsTotal: newTurn.plays - playsBeforeHold,
      pausesGrew: newTurn.pauses > afterHold.pauses,
      speakFlag: speechNet.speakFlags.at(-1),
    };

    await speechPage.screenshot({ path: path.join(outDir, "web-apk-speech-control.png"), fullPage: false });
    report.push({
      viewport: "apk-speech-control",
      speechProbe,
      speakFlags: speechNet.speakFlags,
      checks: {
        // 开关的记忆：点一下关、关浮窗再开、整页刷新，三次都得还是关的
        autoReadDefaultOn: speechProbe.defaultOn,
        toggleTurnsOff: speechProbe.afterClickOff,
        autoReadOffSurvivesReopen: speechProbe.stillOffAfterReopen,
        autoReadOffSurvivesReload: speechProbe.stillOffAfterReload,
        // 关着就是真的不出声，也不让服务端白烧配额
        silentWhenOff: speechProbe.silentTurn?.speakFlag === false && speechProbe.silentTurn?.playsDelta === 0,
        // 开着要念、有声音真的在放
        speaksWhenOn:
          speechProbe.spokenTurn?.speakFlag === true &&
          speechProbe.spokenTurn?.playsDelta === 2 &&
          speechProbe.spokenTurn?.live >= 1 &&
          speechProbe.spokenTurn?.maxTime > 0,
        // 按下录音：当场停嘴
        recordingStopsPlayback:
          speechProbe.cutByRecording?.liveDuringHold === 0 && speechProbe.cutByRecording?.paused === true,
        // 而且不能自己接着念：排队里那半句永远不放，松开后也不复活
        recordingDoesNotResume:
          speechProbe.cutByRecording?.playsWhileHeld === 0 &&
          speechProbe.cutByRecording?.playsAfterRelease === 0 &&
          speechProbe.cutByRecording?.liveAfterRelease === 0,
        // 发新问题：上一轮剩下那半句被丢掉（否则这里会多出一次播放）
        newQuestionDropsQueuedSentence:
          speechProbe.cutByNewQuestion?.playsForFirstTurn === 2 &&
          speechProbe.cutByNewQuestion?.playsTotal === 4 &&
          speechProbe.cutByNewQuestion?.pausesGrew === true,
        // 新问题本身要照常念，不然开关等于白开
        newQuestionStillSpoken: speechProbe.cutByNewQuestion?.speakFlag === true,
        noPageErrors: speechErrors.length === 0,
      },
      errors: [...new Set(speechErrors)].slice(0, 4),
    });
    await speechContext.close();
    await speechBrowser.close();
  }

  /**
   * "发现新版本"单独跑一遍。
   *
   * 安卓 App 是 WebView 承载线上站点，它不会像浏览器那样隔三差五自己重载：
   * 孩子把 App 挂在后台再切回来，跑的还是几天前那一版代码。
   * 这条用例要证明的是——服务器换了版，页面能自己发现并给出一个点得动的入口，
   * 而不是靠家长清缓存、重装 App。
   */
  if (!liveUrlArg) {
    const updateBrowser = await chromium.launch({
      channel: "chrome",
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    const updateContext = await updateBrowser.newContext({
      viewport: { width: 393, height: 851 },
      deviceScaleFactor: 2,
      permissions: ["microphone"],
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; V2312A Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 HeYaAndroid/1.0",
    });
    const updatePage = await updateContext.newPage();
    const updateErrors = [];
    updatePage.on("pageerror", (error) => updateErrors.push(String(error.message).slice(0, 160)));
    updatePage.on("console", (message) => {
      if (message.type() === "error") updateErrors.push(message.text().slice(0, 160));
    });

    const ownVersion = JSON.parse(fs.readFileSync(path.join(distDir, "version.json"), "utf8")).version;
    const newerVersion = `newer-${Date.now().toString(36)}`;
    /**
     * 抓一下页面注册过哪些定时器。
     * 版本检查的要求是"只在页面加载时查一次"，那就不能有任何周期轮询——
     * 光看代码里没写 setInterval 不够，得看运行时真的没排上。
     * 全站目前只有这一个地方可能用 setInterval，所以判据用"一个都没有"。
     */
    const intervalDelays = [];
    // null 表示"按真实情况走"（静态文件里那一版），设成字符串就当服务器换了版
    let versionOverride = null;
    const versionRequests = [];
    await updatePage.addInitScript(() => {
      const original = window.setInterval;
      window.__intervalDelays = [];
      window.setInterval = function setIntervalSpy(_handler, delay, ...rest) {
        window.__intervalDelays.push(Number(delay));
        return original.call(window, _handler, delay, ...rest);
      };
    });
    await updatePage.route("**/version.json*", async (route) => {
      versionRequests.push(route.request().url());
      if (!versionOverride) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ version: versionOverride }),
      });
    });
    await updatePage.route("**/api/**", async (route) => {
      const url = route.request().url();
      const match = stubs.find(([pattern]) => pattern.test(url));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(match ? match[1]() : {}),
      });
    });
    await updatePage.addInitScript(() => localStorage.setItem("familyEduToken", "responsive-check-token"));

    /** 手动催一次检查：App 从后台切回来就是这个时机，不用等定时器 */
    const nudgeCheck = async () => {
      await updatePage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await updatePage.waitForTimeout(900);
    };
    const bannerState = () =>
      updatePage.evaluate(() => {
        const banner = document.querySelector('[data-testid="app-update-banner"]');
        if (!banner) return { present: false };
        const rect = banner.getBoundingClientRect();
        const update = banner.querySelector('button[aria-label="更新到新版本"]');
        const dismiss = banner.querySelector('button[aria-label="稍后再说"]');
        const topbar = document.querySelector("header");
        const bubble = document.querySelector('[data-testid="tutor-dock-bubble"]');
        const box = (el) => {
          const r = el?.getBoundingClientRect();
          return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height } : null;
        };
        const overlaps = (a, b) =>
          !!a && !!b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const bannerBox = box(banner);
        return {
          present: true,
          text: (banner.innerText || "").replace(/\s+/g, " ").trim(),
          box: bannerBox,
          insideViewport:
            rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1,
          updateBox: box(update),
          dismissBox: box(dismiss),
          overlapsHeader: overlaps(bannerBox, box(topbar)),
          overlapsTutorBubble: overlaps(bannerBox, box(bubble)),
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        };
      });

    const updateProbe = { ownVersion, requestedUrl: "", sameVersionNoBanner: false, bannerOnNewVersion: null };

    // 一、服务器还是同一版：不该冒出任何提示
    await updatePage.goto(baseUrl, { waitUntil: "networkidle" });
    // 先什么都不碰地放一会儿：让那次"页面加载后查一次"自然发生，
    // 同时看看这段时间里有没有周期轮询在偷偷多打请求。
    // 这里绝不能自己去催检查，否则数出来的第二次请求是自己造成的。
    await updatePage.waitForTimeout(5500);
    updateProbe.requestedUrl = versionRequests[0] || "";
    updateProbe.versionRequestsAfterIdle = versionRequests.length;
    updateProbe.sameVersionNoBanner = (await bannerState()).present === false;
    intervalDelays.push(...(await updatePage.evaluate(() => window.__intervalDelays || [])));

    // 二、服务器换了版：提示要自己出现
    versionOverride = newerVersion;
    await nudgeCheck();
    updateProbe.bannerOnNewVersion = await bannerState();
    await updatePage.screenshot({ path: path.join(outDir, "web-apk-update-banner.png"), fullPage: false });

    // 三、点"更新"要真的把页面带到新版上（URL 带上新版本号，绕开 WebView 的旧缓存）
    //
    // 点击本身用 try 包住：万一提示没出来（比如有人把这段功能删了），
    // 让用例把结果记成"没过"并继续跑完，比直接抛异常中断更好读——
    // 抛异常只能看到一行栈，看不出到底哪几条不成立。
    const navigation = updatePage.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await updatePage
      .locator('button[aria-label="更新到新版本"]')
      .click({ timeout: 4000 })
      .catch(() => {});
    await navigation;
    await updatePage.waitForTimeout(400);
    updateProbe.afterUpdateUrl = updatePage.url();
    updateProbe.afterUpdateHasVersion = updateProbe.afterUpdateUrl.includes(`v=${newerVersion}`);
    updateProbe.versionAfterUpdate = await updatePage.evaluate(
      () => document.querySelector('meta[name="app-version"]')?.content || "",
    );

    // 四、点"稍后再说"就真的别再提示：再催一次检查也不该回来
    versionOverride = `${newerVersion}-2`;
    await nudgeCheck();
    updateProbe.bannerBeforeDismiss = (await bannerState()).present;
    await updatePage
      .locator('button[aria-label="稍后再说"]')
      .click({ timeout: 4000 })
      .catch(() => {});
    await updatePage.waitForTimeout(400);
    updateProbe.goneAfterDismiss = (await bannerState()).present === false;
    versionOverride = `${newerVersion}-2`;
    await nudgeCheck();
    await nudgeCheck();
    updateProbe.staysHiddenAfterDismiss = (await bannerState()).present === false;

    report.push({
      viewport: "apk-update-prompt",
      updateProbe,
      versionRequests: versionRequests.slice(0, 3),
      // 页面注册过的周期定时器（应为空）——"不做轮询"这件事的证据
      periodicTimers: intervalDelays,
      checks: {
        // 页面问的就是它自己那一版的版本文件，问的地址得对
        asksForVersionFile: /\/family-edu\/version\.json\?t=\d+$/.test(updateProbe.requestedUrl || ""),
        // 不做定时轮询：一个周期定时器都不该有；页面开着不动也只查这一次
        noPeriodicPolling: intervalDelays.length === 0 && updateProbe.versionRequestsAfterIdle === 1,
        // 同一版不打扰
        noBannerWhenUpToDate: updateProbe.sameVersionNoBanner,
        bannerAppearsOnNewVersion: updateProbe.bannerOnNewVersion?.present === true,
        bannerSaysWhatItIs: (updateProbe.bannerOnNewVersion?.text || "").includes("有新版本"),
        // 得是"点得动"的：撑满一行、在视口里，且不压住顶栏和私教浮标
        bannerFitsAndDoesNotCover:
          updateProbe.bannerOnNewVersion?.insideViewport === true &&
          updateProbe.bannerOnNewVersion?.overflowX === 0 &&
          updateProbe.bannerOnNewVersion?.overlapsHeader === false &&
          updateProbe.bannerOnNewVersion?.overlapsTutorBubble === false,
        updateButtonTappable:
          (updateProbe.bannerOnNewVersion?.updateBox?.h ?? 0) >= 32 &&
          (updateProbe.bannerOnNewVersion?.updateBox?.w ?? 0) >= 44 &&
          (updateProbe.bannerOnNewVersion?.dismissBox?.w ?? 0) >= 32,
        // 点一下就真的换到新版（带版本号重载，绕开 WebView 里那份旧 html）
        updateLoadsNewVersion: updateProbe.afterUpdateHasVersion === true && updateProbe.versionAfterUpdate === ownVersion,
        // "稍后"是真稍后：收起之后不再反复冒出来
        dismissHidesBanner: updateProbe.bannerBeforeDismiss === true && updateProbe.goneAfterDismiss === true,
        dismissDoesNotNag: updateProbe.staysHiddenAfterDismiss === true,
        noPageErrors: updateErrors.length === 0,
      },
      errors: [...new Set(updateErrors)].slice(0, 4),
    });
    await updateContext.close();
    await updateBrowser.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(JSON.stringify(report, null, 2));
