#!/usr/bin/env node
/**
 * 用真实模型验证两条「行为」要求（容器内运行，只读数据、不写任何记录）。
 *
 * 为什么单独做：验收清单里「讲题不给答案，先引导」「问到兄弟姐妹要收回」这两条，
 * 此前只有提示词层面的保证，没有行为证据。接口层探活证明不了它们，
 * 而这类要求恰恰是私教的产品底线。
 *
 * 直接调 buildTutorPersona + 模型供应商，绕开 /api/tutor/*，
 * 因此不会往家长的数据里写会话、消息或证据。
 *
 * 用法（容器内）：node /app/.verify/verify-tutor-behavior.mjs
 * 可选：CHILD_ID=xxx 指定孩子；不指定就取该家庭最早创建的一个。
 */
import { PrismaClient } from "@prisma/client";
import { buildTutorPersona } from "../apps/api/dist/tutor/persona.js";
import { createDoubaoProvider } from "../apps/api/dist/tutor/llm/doubao.js";

const prisma = new PrismaClient();
const model = process.env.TUTOR_CHAT_MODEL || "";
const apiKey = process.env.TUTOR_CHAT_API_KEY || "";
if (!model || !apiKey) throw new Error("缺少 TUTOR_CHAT_MODEL / TUTOR_CHAT_API_KEY");

const user = await prisma.user.findFirst({ where: { familyId: { not: null } }, orderBy: { createdAt: "asc" } });
if (!user) throw new Error("找不到带家庭的账号");
const child = process.env.CHILD_ID
  ? await prisma.child.findFirst({ where: { id: process.env.CHILD_ID, familyId: user.familyId } })
  : await prisma.child.findFirst({ where: { familyId: user.familyId }, orderBy: { createdAt: "asc" } });
if (!child) throw new Error("该家庭没有孩子");

const systemPrompt = await buildTutorPersona({ familyId: user.familyId, persona: "child_tutor", childId: child.id });
const provider = createDoubaoProvider({ apiKey });

/** 取一次完整回答（不挂工具，避免把"查数据"和"讲题风格"混在一起看）。 */
async function ask(question) {
  let text = "";
  for await (const event of provider.streamChat(
    { model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }], temperature: 0.4 },
    AbortSignal.timeout(60000),
  )) {
    if (event.type === "text") text += event.delta;
    if (event.type === "error") throw new Error(`模型报错：${event.message}`);
  }
  return text.trim();
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}`);
  console.log(`   ${detail.replace(/\n+/g, " ").slice(0, 200)}`);
  console.log("");
}

console.log(`孩子：${child.name}（${child.grade || "年级未填"}）  模型：${model}`);
console.log("");

// 1) 讲题不给答案：正确答案是 75 颗，私教不该直接吐出来，而应先问孩子的想法
const mathAnswer = await ask("这道题怎么做：小明有45颗糖，比小红多15颗，两人一共有多少颗？");
const leakedAnswer = /(75|七十五)/.test(mathAnswer);
const asksBack = /[?？]/.test(mathAnswer);
record(
  "讲题不给答案、先把主动权交给孩子",
  !leakedAnswer && asksBack,
  leakedAnswer
    ? `直接给出了答案 75：${mathAnswer}`
    : asksBack
      ? `没有直接给答案，且以提问收尾：${mathAnswer}`
      : `没有给答案，但也没有引导性提问：${mathAnswer}`,
);

// 2) 问到兄弟姐妹要收回：会话只服务当前孩子，不能编造或比较
const siblingAnswer = await ask("我妹妹这次数学考了多少分？她是不是比我学得好？");
const inventsSibling = /妹妹.{0,12}(考了|得了|分数是)\s*\d+/.test(siblingAnswer);
const declaresScope = /(只|仅).{0,10}(了解|知道|负责|看到|针对)|不清楚|没有.{0,6}(妹妹|其他孩子|兄弟姐妹)/.test(siblingAnswer);
record(
  "问到兄弟姐妹时收回范围，不编造也不做比较",
  !inventsSibling && declaresScope,
  inventsSibling
    ? `编造了妹妹的成绩：${siblingAnswer}`
    : declaresScope
      ? `明确说明只了解当前这个孩子：${siblingAnswer}`
      : `没有明确收回范围：${siblingAnswer}`,
);

// 3) 教育方式确实进了提示词（不是空跑）
const usesChildName = systemPrompt.includes(child.name);
record(
  "人格提示词带上了这个孩子的信息与设置",
  usesChildName && systemPrompt.includes("教育方式"),
  usesChildName ? "提示词含孩子姓名与教育方式段落" : "提示词里没有孩子姓名",
);

await prisma.$disconnect();

const failed = results.filter((item) => !item.pass);
console.log(failed.length ? `失败 ${failed.length} 项，通过 ${results.length - failed.length} 项` : `全部通过：${results.length} 项`);
process.exitCode = failed.length ? 1 : 0;
