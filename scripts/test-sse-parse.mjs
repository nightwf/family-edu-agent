#!/usr/bin/env node
/**
 * `scripts/lib/sse-parse.mjs` 的用例。
 * 线上验证靠它判断"模型到底有没有回答"，所以分块边界这类细节必须可证。
 */
import assert from "node:assert/strict";
import { createSseParser, summarizeRoundTrip } from "./lib/sse-parse.mjs";

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

/** 把一个完整事件流按给定字节长度切碎，模拟网络分块。 */
function feedInChunks(text, size) {
  const parser = createSseParser();
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(...parser.push(text.slice(i, i + size)));
  }
  out.push(...parser.flush());
  return out;
}

const STREAM = [
  'event: text\ndata: {"delta":"你好"}\n\n',
  'event: tool\ndata: {"name":"list_children","ok":true}\n\n',
  'event: text\ndata: {"delta":"JOJO"}\n\n',
  'event: error\ndata: {"message":"模型超时","detail":"AbortError"}\n\n',
  'event: done\ndata: {"usage":{"promptTokens":1}}\n\n',
].join("");

console.log("sse-parse：分块边界");

check("一次性喂入等于逐字节喂入（任意切分都不丢事件）", () => {
  const whole = feedInChunks(STREAM, STREAM.length);
  assert.equal(whole.length, 5);
  for (const size of [1, 2, 3, 7, 13, 64]) {
    const chunks = feedInChunks(STREAM, size);
    assert.deepEqual(chunks, whole, `按 ${size} 字符切分时结果不一致`);
  }
});

check("未收完的事件不提前吐出", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: text\ndata: {"delta":"半'), []);
  assert.deepEqual(parser.push('句"}\n'), []);
  const done = parser.push("\n");
  assert.equal(done.length, 1);
  assert.equal(done[0].event, "text");
});

check("结尾没补空行时 flush 也能拿到", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: text\ndata: {"delta":"尾"}'), []);
  const rest = parser.flush();
  assert.equal(rest.length, 1);
  assert.equal(JSON.parse(rest[0].data).delta, "尾");
});

check("flush 后缓冲区清空，不会重复吐事件", () => {
  const parser = createSseParser();
  parser.push('event: text\ndata: {"delta":"x"}');
  assert.equal(parser.flush().length, 1);
  assert.equal(parser.flush().length, 0);
});

check("多行 data 按规范拼接", () => {
  const events = feedInChunks('event: text\ndata: {"delta":"a"}\ndata: {\n\n', 5);
  assert.equal(events.length, 1);
  assert.equal(events[0].data, '{"delta":"a"}\n{');
});

console.log("sse-parse：汇总结果");

check("文本累加、工具调用记录、错误带 detail", () => {
  const summary = summarizeRoundTrip(feedInChunks(STREAM, 3));
  assert.equal(summary.events.text, 2);
  assert.equal(summary.events.tool, 1);
  assert.equal(summary.events.done, 1);
  // "你好" 2 字 + "JOJO" 4 字
  assert.equal(summary.textLength, 6);
  assert.equal(summary.preview, "你好JOJO");
  assert.deepEqual(summary.toolCalls, ["list_children"]);
  assert.equal(summary.errors.length, 1);
  assert.ok(summary.errors[0].includes("模型超时"));
  assert.ok(summary.errors[0].includes("AbortError"));
});

check("工具失败会被标出来，不混进成功", () => {
  const summary = summarizeRoundTrip(feedInChunks('event: tool\ndata: {"name":"save_x","ok":false}\n\n', 4));
  assert.deepEqual(summary.toolCalls, ["save_x(失败)"]);
});

check("兼容旧的 tool_call / tool_result 事件名", () => {
  const summary = summarizeRoundTrip(
    feedInChunks('event: tool_call\ndata: {"name":"a","ok":true}\n\nevent: tool_result\ndata: {"name":"b","ok":true}\n\n', 7),
  );
  assert.deepEqual(summary.toolCalls, ["a", "b"]);
});

check("没有文本时文本长度为 0（不当成成功）", () => {
  const summary = summarizeRoundTrip(feedInChunks('event: done\ndata: {"usage":{}}\n\n', 5));
  assert.equal(summary.textLength, 0);
  assert.equal(summary.preview, "");
});

check("无法解析的 data 不会让汇总崩掉", () => {
  const summary = summarizeRoundTrip(feedInChunks("event: text\ndata: 不是JSON\n\n", 5));
  assert.equal(summary.events.text, 1);
  assert.equal(summary.textLength, 0);
});

check("preview 最多 120 字，避免把长回答灌进日志", () => {
  const long = `event: text\ndata: ${JSON.stringify({ delta: "a".repeat(500) })}\n\n`;
  const summary = summarizeRoundTrip(feedInChunks(long, 64));
  assert.equal(summary.textLength, 500);
  assert.equal(summary.preview.length, 120);
});

console.log("");
if (failures.length) {
  console.log(`失败 ${failures.length} 项，通过 ${passed} 项`);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 项`);
}
