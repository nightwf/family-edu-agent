import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import {
  listChildren,
  listRecords,
  listReports,
  listKnowledgeItems,
  listTextbooks,
  listHomework,
  growthSeries,
} from "./store.js";

const SKILLS_DIR = path.join(ROOT, "skills");
const INDEX_FILE = path.join(SKILLS_DIR, "index.json");

export function listEducationSkills() {
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
}

export function getEducationSkill(skillId) {
  const skills = listEducationSkills();
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) return null;
  const file = path.join(SKILLS_DIR, skill.file);
  return {
    ...skill,
    content: fs.readFileSync(file, "utf8"),
  };
}

export function getCoachingPolicy(skillId) {
  return getEducationSkill(skillId);
}

export function buildChildContext(familyId, childId) {
  const children = listChildren(familyId);
  const child = children.find((item) => item.id === childId);
  if (!child) return null;
  const records = listRecords(childId);
  const reports = listReports(childId);
  const knowledge = listKnowledgeItems(familyId).filter((item) => item.child_id === childId);
  const textbooks = listTextbooks(familyId).filter((item) => item.child_id === childId);
  const homework = listHomework(childId);
  return {
    child,
    recent_records: records.slice(-10),
    record_count: records.length,
    reports: reports.slice(-3),
    growth: growthSeries(childId),
    knowledge: knowledge.slice(-5),
    textbooks,
    homework: homework.slice(-10),
  };
}
