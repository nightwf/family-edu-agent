#!/usr/bin/env node
/**
 * 语音自检判定逻辑的用例（不联网）。
 * 重点是「火山业务错误藏在 HTTP 200 里」和「识别吞掉标点不算失败」这两类真实情形。
 */
import assert from "node:assert/strict";
import { humanizeVoiceError, judgeRoundTrip, normalizeSpeech, similarity } from "./lib/voice-check.mjs";

let passed = 0;
let failed = 0;
function it(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`      ${error.message}`);
  }
}

console.log("voice-check：上游报错翻人话");

it("HTTP 200 但业务 code 报错时，也会被当成失败并带出原文", () => {
  const message = humanizeVoiceError({ part: "tts", status: 200, body: { code: 3001, message: "invalid cluster" } });
  assert.match(message, /code=3001/);
  assert.match(message, /cluster/);
  assert.match(message, /invalid cluster/);
});

it("token 类报错指向「语音技术凭据」，避免与方舟 API Key 混淆", () => {
  const message = humanizeVoiceError({ part: "tts", status: 403, body: "authentication failed" });
  assert.match(message, /Access Token/);
  assert.match(message, /方舟 API Key/);
});

it("未开通 / 配额 / 音色 分别给出不同动作", () => {
  assert.match(humanizeVoiceError({ part: "asr", status: 200, body: { message: "service not activated" } }), /没开通/);
  assert.match(humanizeVoiceError({ part: "asr", status: 200, body: { message: "quota exceeded" } }), /配额/);
  assert.match(humanizeVoiceError({ part: "tts", status: 200, body: { message: "invalid voice_type" } }), /音色/);
});

it("无法归类的报错也把上游原文带出来，不吞掉", () => {
  const message = humanizeVoiceError({ part: "asr", status: 502, body: { message: "gateway boom" } });
  assert.match(message, /gateway boom/);
});

console.log("voice-check：文本比对");

it("标点与空白差异不算不同", () => {
  const judged = judgeRoundTrip("今天我们一起把这道题弄明白", "今天我们一起，把这道题弄明白。");
  assert.equal(judged.passed, true);
  assert.equal(judged.score, 1);
});

it("识别成繁体/标点缺失仍判通过", () => {
  assert.equal(judgeRoundTrip("今天我们一起把这道题弄明白", "今天我们一起把这道题弄明白").passed, true);
});

it("听成另一句话时判不通过", () => {
  const judged = judgeRoundTrip("今天我们一起把这道题弄明白", "明天我们要去公园玩沙子");
  assert.equal(judged.passed, false);
  assert.ok(judged.score < 0.6);
});

it("全角数字与半角等价", () => {
  assert.equal(normalizeSpeech("４５颗糖"), normalizeSpeech("45颗糖"));
});

it("一句空的识别结果算不通过，而不是算满分", () => {
  assert.equal(judgeRoundTrip("今天我们一起把这道题弄明白", "").passed, false);
  assert.equal(similarity("a", ""), 0);
});

console.log("");
if (failed) {
  console.log(`❌ ${failed} 项失败，${passed} 项通过`);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 项`);
}
