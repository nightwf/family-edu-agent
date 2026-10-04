#!/usr/bin/env node
/**
 * 守住"孩子开口的第一个字不能被吃掉"。
 *
 * 这个 bug 没法用单元测试复现（丢的是设备预热那几百毫秒的真声音），
 * 所以改成对源码立规矩：谁把这两条改回去，检查就红。
 *
 *   1. 语音输入不能等 click 才申请麦克风 —— 要抢在 pointerdown；
 *   2. 语音输入不能开回声消除/自动增益 —— 它们收敛期间就是那个"丢字"窗口。
 *
 * 同时反向守住连续对话：那边必须保留回声消除，两套参数不能合并。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(join(root, "apps/web/src/components/TutorChat.tsx"), "utf8");
const mic = readFileSync(join(root, "apps/web/src/lib/mic.ts"), "utf8");
const loop = readFileSync(join(root, "apps/web/src/lib/tutor-voice.ts"), "utf8");

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${error?.message}`);
  }
}

console.log("语音输入开头的字：");

check("麦克风在 pointerdown 就申请，不等 click", () => {
  assert.match(chat, /onPointerDown=\{\(\) => void startRecording\(\)\}/, "按钮上必须挂 pointerdown");
});

check("键盘触发仍保留 onClick 兜底", () => {
  assert.match(chat, /onClick=\{\(\) => void startRecording\(\)\}/);
});

check("重复触发被 ref 挡住（不会开两个麦克风）", () => {
  assert.match(chat, /micOpeningRef\.current/, "缺少 micOpeningRef");
  assert.match(chat, /if \(micOpeningRef\.current \|\| recorderRef\.current\) return;/);
});

check("语音输入走专用参数，不用浏览器默认音频处理链", () => {
  assert.match(chat, /openDictationStream\(\)/, "没有用 openDictationStream");
  assert.ok(
    !/getUserMedia\(\s*\{\s*audio:\s*true\s*\}\s*\)/.test(chat),
    "TutorChat 里还有裸的 getUserMedia({ audio: true })",
  );
});

check("专用参数关掉回声消除与自动增益，并保持单声道", () => {
  assert.match(mic, /echoCancellation:\s*false/);
  assert.match(mic, /autoGainControl:\s*false/);
  assert.match(mic, /channelCount:\s*1/);
});

check("连续对话仍然保留回声消除（不能被一起关掉）", () => {
  assert.match(loop, /echoCancellation:\s*true/, "免提模式靠它过滤私教自己的声音");
});

check("连续对话等麦克风热起来再让孩子开口", () => {
  assert.match(loop, /micWarmupMs:\s*[1-9]/, "缺少预热时长");
  assert.match(loop, /await warmUpMic\(\)/, "start() 里没有等预热");
  assert.match(loop, /function endWarmup\(\)/, "缺提前结束预热，stop() 会把 start() 卡住");
});

check("语音输入等预热结束才宣称正在聆听", () => {
  assert.match(mic, /export const DICTATION_WARMUP_MS = [1-9]/);
  assert.match(chat, /await new Promise\(\(resolve\) => window\.setTimeout\(resolve, DICTATION_WARMUP_MS\)\)/);
});

if (failures.length) {
  console.log(`\n语音输入检查：${passed} 项通过，${failures.length} 项失败`);
  process.exit(1);
}
console.log(`\n语音输入检查：${passed} 项通过，0 项失败`);
