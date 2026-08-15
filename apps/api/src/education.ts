import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./prisma.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = process.env.SKILLS_DIR || path.resolve(currentDir, "../../../skills");
const indexFile = path.join(skillsDir, "index.json");

type EducationSkill = {
  id: string;
  name: string;
  description: string;
  ages: string;
  scenario: string;
  file: string;
};

export function listEducationSkills(): EducationSkill[] {
  return JSON.parse(fs.readFileSync(indexFile, "utf8")) as EducationSkill[];
}

export function getEducationSkill(skillId: string) {
  const skills = listEducationSkills();
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return null;
  return {
    ...skill,
    content: fs.readFileSync(path.join(skillsDir, skill.file), "utf8"),
  };
}

export function getCoachingPolicy(skillId: string) {
  return getEducationSkill(skillId);
}

export async function buildChildContext(familyId: string, childId: string) {
  const [child, records, reports, knowledge, textbooks, homework] = await Promise.all([
    prisma.child.findFirst({ where: { id: childId, familyId } }),
    prisma.record.findMany({ where: { childId, familyId }, orderBy: { date: "desc" }, take: 20 }),
    prisma.report.findMany({ where: { childId, familyId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.knowledgeItem.findMany({ where: { childId, familyId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.textbook.findMany({ where: { childId, familyId } }),
    prisma.homework.findMany({ where: { childId, familyId }, orderBy: { dueDate: "asc" }, take: 20 }),
  ]);
  if (!child) return null;
  return { child, recentRecords: records, reports, knowledge, textbooks, homework };
}
