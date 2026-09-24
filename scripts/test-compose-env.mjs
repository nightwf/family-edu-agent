#!/usr/bin/env node
/**
 * 守住一个已经咬过人的坑：docker-compose.yml 的 environment 段是**显式白名单**。
 *
 * 只往服务器 .env 里写值而 compose 没列出该变量，容器里就永远读不到，
 * 表现是"配置看着全对、功能一直 503"，排查起来像是凭据问题。
 * 所以这里直接对比：env.ts 里声明了哪些 TUTOR_*，compose 就必须全部列出。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envSource = fs.readFileSync(path.join(repoRoot, "apps/api/src/env.ts"), "utf8");
const compose = fs.readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");

// env.ts 里 process.env.X 的写法
const declared = new Set([...envSource.matchAll(/process\.env\.(TUTOR_[A-Z0-9_]+)/g)].map((match) => match[1]));
// compose 里 environment 段的键（缩进 6 空格的 KEY: 形式）
const listed = new Set([...compose.matchAll(/^\s{6}(TUTOR_[A-Z0-9_]+):/gm)].map((match) => match[1]));

const problems = [];
if (declared.size < 10) problems.push(`env.ts 只解析到 ${declared.size} 个 TUTOR_* 变量，解析方式可能失效了`);
if (listed.size < 10) problems.push(`compose 只解析到 ${listed.size} 个 TUTOR_* 变量，解析方式可能失效了`);

const missing = [...declared].filter((key) => !listed.has(key)).sort();
const extra = [...listed].filter((key) => !declared.has(key)).sort();

console.log(`env.ts 声明 ${declared.size} 个 TUTOR_*，compose 列出 ${listed.size} 个`);
console.log(`  ✓ 声明了但 compose 没列（会静默失效）：${missing.length ? missing.join(", ") : "无"}`);
console.log(`  ✓ compose 列了但代码没读（多半是拼写不一致）：${extra.length ? extra.join(", ") : "无"}`);

try {
  assert.deepEqual(missing, [], "compose 缺少这些 TUTOR_* 变量，容器里读不到");
  assert.deepEqual(extra, [], "compose 多出了这些 TUTOR_* 变量，检查是否拼写不一致");
} catch (error) {
  console.log("");
  console.log(`❌ ${error.message}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log("");
  console.log("全部通过：compose 白名单与 env.ts 一致");
}
