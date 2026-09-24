#!/usr/bin/env node
/**
 * `scripts/lib/api-shapes.mjs` 的用例。
 * 回归点：建会话响应是 `{ conversation: { id } }`，
 * 取错字段会让验证脚本往 undefined 发消息、报出误导性的"会话不存在"。
 */
import assert from "node:assert/strict";
import { pickConversationId, pickList } from "./lib/api-shapes.mjs";

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

console.log("api-shapes：会话 ID");

check("识别后端真实结构 { conversation: { id } }", () => {
  assert.equal(pickConversationId({ conversation: { id: "conv-1", childId: "c1" } }), "conv-1");
});

check("兼容裸 { id }", () => {
  assert.equal(pickConversationId({ id: "conv-2" }), "conv-2");
});

check("兼容 { conversationId }", () => {
  assert.equal(pickConversationId({ conversationId: "conv-3" }), "conv-3");
});

check("取不到时返回空串，而不是 undefined", () => {
  assert.equal(pickConversationId(null), "");
  assert.equal(pickConversationId({}), "");
  assert.equal(pickConversationId({ conversation: {} }), "");
  assert.equal(pickConversationId("nope"), "");
  // 非字符串 id 不采信，避免把对象塞进 URL
  assert.equal(pickConversationId({ id: 123 }), "");
});

console.log("api-shapes：列表");

check("裸数组直接返回", () => {
  assert.deepEqual(pickList([1, 2]), [1, 2]);
});

check("按给定键取出数组", () => {
  assert.deepEqual(pickList({ conversations: [{ id: "a" }] }, ["conversations"]), [{ id: "a" }]);
});

check("键不存在或结构异常时返回空数组", () => {
  assert.deepEqual(pickList({ other: 1 }, ["conversations"]), []);
  assert.deepEqual(pickList(null, ["conversations"]), []);
  assert.deepEqual(pickList(undefined, []), []);
});

console.log("");
if (failures.length) {
  console.log(`失败 ${failures.length} 项，通过 ${passed} 项`);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 项`);
}
