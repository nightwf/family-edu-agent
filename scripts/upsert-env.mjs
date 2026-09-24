#!/usr/bin/env node
/**
 * 幂等地改 .env：只动指定的键，其余原样保留。
 *
 * 为什么不直接用 sed：
 *   - 同一键写两次会让「后写生效」，排查时看不出真值；
 *   - 直接覆盖会丢掉别人的配置和注释。
 *
 * 用法：
 *   node scripts/upsert-env.mjs --file=/opt/family-edu-agent/.env --set=TUTOR_ENABLED=true --set=TUTOR_CHAT_MODEL=xxx
 *   node scripts/upsert-env.mjs --file=x.env --set=A=1 --dry-run    # 只打印结果，不落盘
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { file: "", sets: [], dryRun: false, noBackup: false, quiet: false };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith("--file=")) args.file = raw.slice(7);
    else if (raw.startsWith("--set=")) args.sets.push(raw.slice(6));
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--no-backup") args.noBackup = true;
    else if (raw === "--quiet") args.quiet = true;
    else if (raw === "--help" || raw === "-h") args.help = true;
  }
  return args;
}

/** 解析 KEY=VALUE；值里允许带 = 和空格，所以只切第一个等号。 */
export function parsePairs(sets) {
  const map = new Map();
  for (const raw of sets) {
    const index = raw.indexOf("=");
    if (index <= 0) throw new Error(`参数格式应为 KEY=VALUE，收到：${raw}`);
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`非法变量名：${key}`);
    map.set(key, value);
  }
  return map;
}

/**
 * 在文本里就地替换或追加。
 * 已有键只改第一处出现的位置，后续重复行会被删掉（避免"后写覆盖前写"的隐形坑）。
 */
export function upsertEnvText(text, pairs) {
  const lines = text.split("\n");
  const used = new Set();
  const out = [];
  const appended = [];

  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (!key || !pairs.has(key)) {
      out.push(line);
      continue;
    }
    if (used.has(key)) continue; // 重复行丢掉
    used.add(key);
    out.push(`${key}=${pairs.get(key)}`);
  }

  for (const [key, value] of pairs) {
    if (!used.has(key)) appended.push(`${key}=${value}`);
  }

  // 追加前保证结尾有空行分隔，且不产生连续空行
  if (appended.length) {
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    // 空文件/全新文件不需要前置空行
    if (out.length) out.push("");
    out.push(...appended);
  }

  const result = out.join("\n");
  return result.endsWith("\n") ? result : `${result}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("用法：node scripts/upsert-env.mjs --file=<路径> --set=KEY=VALUE [--set=K2=V2] [--dry-run]");
    return;
  }
  if (!args.file) throw new Error("缺少 --file");
  if (!args.sets.length) throw new Error("至少给一个 --set=KEY=VALUE");

  const pairs = parsePairs(args.sets);
  const exists = fs.existsSync(args.file);
  const before = exists ? fs.readFileSync(args.file, "utf8") : "";
  const after = upsertEnvText(before, pairs);

  if (!args.dryRun) {
    if (exists && !args.noBackup) fs.writeFileSync(`${args.file}.bak`, before, { mode: 0o600 });
    fs.writeFileSync(args.file, after, { mode: 0o600 });
  }

  if (!args.quiet) {
    console.log(`${args.dryRun ? "[dry-run] " : ""}${args.dryRun ? "将写入" : "已写入"} ${args.file}`);
    for (const key of pairs.keys()) {
      // 不打印密钥值，只报长度，日志可以留存
      const value = pairs.get(key);
      const shown = /KEY|TOKEN|SECRET|PASSWORD/i.test(key)
        ? `(已设置，${value.length} 字符)`
        : value;
      console.log(`  ${key}=${shown}`);
    }
    if (exists && args.dryRun) console.log("  （未落盘）");
  }
}

// 只有被当脚本直接执行时才跑主流程。
// 注意不能用 `argv[1].endsWith("upsert-env.mjs")`：`test-upsert-env.mjs` 也满足这个后缀，
// 结果测试文件一 import 就把主流程跑起来（曾因此把报错混进测试输出、并可能误改文件）。
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath === selfPath) {
  try {
    main();
  } catch (error) {
    console.error("失败：", error?.message || error);
    process.exitCode = 1;
  }
}
