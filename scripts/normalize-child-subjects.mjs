/**
 * 一次性修数据：把早期被当成「一个学科」存下来的顿号串拆开。
 *
 * 背景：电脑端孩子档案表单的回填值是顿号连接的（"英语、数学、语文"），
 * 但早期接口只按逗号切分，于是编辑一次就整串存进 Child.subjects 的单个元素里，
 * 首页只会显示一张写着「英语、数学、语文…」的假学科卡。接口已修，
 * 这里把已经写坏的历史数据补齐。只做拆分，不改动其他字段。
 *
 * 用法：node scripts/normalize-child-subjects.mjs [--dry-run]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const SEPARATORS = /[,，、;；]/;

function splitSubjects(subjects) {
  if (!Array.isArray(subjects)) return [];
  return subjects
    .flatMap((item) => String(item || "").split(SEPARATORS))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

const children = await prisma.child.findMany({ select: { id: true, name: true, subjects: true } });
let fixed = 0;

for (const child of children) {
  const current = Array.isArray(child.subjects) ? child.subjects : [];
  const normalized = splitSubjects(current);
  if (normalized.length === current.length) continue;
  console.log(`${dryRun ? "[dry-run] " : ""}${child.name}: ${JSON.stringify(current)} -> ${JSON.stringify(normalized)}`);
  if (!dryRun) {
    await prisma.child.update({ where: { id: child.id }, data: { subjects: normalized } });
  }
  fixed += 1;
}

console.log(`检查 ${children.length} 个学生，${dryRun ? "待修" : "已修"} ${fixed} 个`);
await prisma.$disconnect();
