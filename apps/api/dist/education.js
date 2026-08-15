import fs from "node:fs";
import path from "node:path";
import { prisma } from "./prisma.js";
const skillsDir = process.env.SKILLS_DIR || path.resolve(process.cwd(), "skills");
const indexFile = path.join(skillsDir, "index.json");
export function listEducationSkills() {
    return JSON.parse(fs.readFileSync(indexFile, "utf8"));
}
export function getEducationSkill(skillId) {
    const skills = listEducationSkills();
    const skill = skills.find((item) => item.id === skillId);
    if (!skill)
        return null;
    return {
        ...skill,
        content: fs.readFileSync(path.join(skillsDir, skill.file), "utf8"),
    };
}
export function getCoachingPolicy(skillId) {
    return getEducationSkill(skillId);
}
export async function buildChildContext(familyId, childId) {
    const [child, records, reports, knowledge, textbooks, homework] = await Promise.all([
        prisma.child.findFirst({ where: { id: childId, familyId } }),
        prisma.record.findMany({ where: { childId, familyId }, orderBy: { date: "desc" }, take: 20 }),
        prisma.report.findMany({ where: { childId, familyId }, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.knowledgeItem.findMany({ where: { childId, familyId }, orderBy: { createdAt: "desc" }, take: 5 }),
        prisma.textbook.findMany({ where: { childId, familyId } }),
        prisma.homework.findMany({ where: { childId, familyId }, orderBy: { dueDate: "asc" }, take: 20 }),
    ]);
    if (!child)
        return null;
    return { child, recentRecords: records, reports, knowledge, textbooks, homework };
}
