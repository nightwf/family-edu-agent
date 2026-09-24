#!/usr/bin/env node
/**
 * `scripts/upsert-env.mjs` 的用例。
 * 这个脚本会直接改线上 .env，所以它的行为必须是可证的，而不是"看着没问题"。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parsePairs, upsertEnvText } from "./upsert-env.mjs";

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error?.message}`);
  }
}

console.log("upsert-env：文本替换规则");

check("空文件里新增键", () => {
  const out = upsertEnvText("", parsePairs(["A=1"]));
  assert.equal(out, "A=1\n");
});

check("已有键就地替换，行序不变", () => {
  const before = "B=2\nA=old\nC=3\n";
  const out = upsertEnvText(before, parsePairs(["A=new"]));
  assert.equal(out, "B=2\nA=new\nC=3\n");
});

check("重复键只保留一处，取本次传入的值", () => {
  const before = "A=first\nB=2\nA=second\n";
  const out = upsertEnvText(before, parsePairs(["A=final"]));
  assert.equal(out, "A=final\nB=2\n");
});

check("值里含 = 与空格不被截断", () => {
  const out = upsertEnvText("", parsePairs(["A =a=b c "]));
  assert.equal(out, "A=a=b c \n");
});

check("注释与空行原样保留", () => {
  const before = "# 顶部注释\n\nA=1\n\n# 中间注释\nB=2\n";
  const out = upsertEnvText(before, parsePairs(["A=9"]));
  assert.equal(out, "# 顶部注释\n\nA=9\n\n# 中间注释\nB=2\n");
});

check("新增键追加在末尾，不产生连续空行", () => {
  const before = "A=1\n\n\n";
  const out = upsertEnvText(before, parsePairs(["B=2"]));
  assert.equal(out, "A=1\n\nB=2\n");
});

check("未提及的键一个字节都不动", () => {
  const before = [
    "JWT_SECRET=keep-me",
    "WECHAT_APP_ID=wx123",
    "MCP_FAMILY_ID=family_001",
    "",
  ].join("\n");
  const out = upsertEnvText(before, parsePairs(["TUTOR_ENABLED=true"]));
  assert.ok(out.includes("JWT_SECRET=keep-me"));
  assert.ok(out.includes("WECHAT_APP_ID=wx123"));
  assert.ok(out.includes("MCP_FAMILY_ID=family_001"));
  assert.ok(out.endsWith("TUTOR_ENABLED=true\n"));
  assert.equal(out.split("\n").filter((line) => line.startsWith("JWT_SECRET")).length, 1);
});

check("值里带引号也能原样写入", () => {
  const out = upsertEnvText("", parsePairs(['A="quoted value"']));
  assert.equal(out, 'A="quoted value"\n');
});

console.log("upsert-env：参数校验");

check("缺等号的参数被拒绝", () => {
  assert.throws(() => parsePairs(["JUSTAKEY"]), /KEY=VALUE/);
});

check("非法变量名被拒绝", () => {
  assert.throws(() => parsePairs(["1BAD=1"]), /非法变量名/);
});

check("空值允许（用于清空某项）", () => {
  const out = upsertEnvText("A=old\n", parsePairs(["A="]));
  assert.equal(out, "A=\n");
});

console.log("upsert-env：真实文件读写（含备份与 dry-run）");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upsert-env-"));
const file = path.join(dir, ".env");
const script = path.join(import.meta.dirname, "upsert-env.mjs");
const original = ["JWT_SECRET=abc", "TUTOR_ENABLED=false", ""].join("\n");
fs.writeFileSync(file, original);

check("dry-run 不落盘", () => {
  execFileSync(process.execPath, [script, `--file=${file}`, "--set=TUTOR_ENABLED=true", "--dry-run", "--quiet"]);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

check("实写生效并留下 .bak 备份", () => {
  execFileSync(process.execPath, [script, `--file=${file}`, "--set=TUTOR_ENABLED=true", "--set=TUTOR_CHAT_MODEL=m1", "--quiet"]);
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.includes("TUTOR_ENABLED=true"));
  assert.ok(after.includes("TUTOR_CHAT_MODEL=m1"));
  assert.equal(fs.readFileSync(`${file}.bak`, "utf8"), original);
});

check("重复执行结果稳定（幂等）", () => {
  const first = fs.readFileSync(file, "utf8");
  execFileSync(process.execPath, [script, `--file=${file}`, "--set=TUTOR_ENABLED=true", "--set=TUTOR_CHAT_MODEL=m1", "--quiet"]);
  assert.equal(fs.readFileSync(file, "utf8"), first);
});

check("文件不存在时创建，权限 600", () => {
  const fresh = path.join(dir, "fresh.env");
  execFileSync(process.execPath, [script, `--file=${fresh}`, "--set=A=1", "--quiet"]);
  assert.equal(fs.readFileSync(fresh, "utf8"), "A=1\n");
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
});

check("缺 --file 时非零退出", () => {
  // stderr 显式吞掉：这里的报错是预期行为，不该混进用例输出
  assert.throws(() => execFileSync(process.execPath, [script, "--set=A=1"], { stdio: ["ignore", "pipe", "ignore"] }));
});

check("被当模块导入时不执行主流程", () => {
  // 回归：曾用 endsWith("upsert-env.mjs") 判断是否直接执行，
  // 而 "test-upsert-env.mjs" 也满足该后缀，导致 import 就跑主流程。
  const url = pathToFileURL(script).href;
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ["-e", `await import(${JSON.stringify(url)});`], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
});

fs.rmSync(dir, { recursive: true, force: true });

console.log("");
if (failures.length) {
  console.log(`失败 ${failures.length} 项，通过 ${passed} 项`);
  process.exitCode = 1;
} else {
  console.log(`全部通过：${passed} 项`);
}
