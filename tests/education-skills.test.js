import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "family-edu-skills-test-"));
process.env.DB_FILE = path.join(tempDir, "db.json");
process.env.UPLOAD_DIR = path.join(tempDir, "uploads");

const store = await import("../src/store.js");
const education = await import("../src/education-skills.js");

test("education skill library contains five coaches", () => {
  const skills = education.listEducationSkills();
  assert.equal(skills.length, 5);
  assert.ok(skills.some((skill) => skill.id === "writing-coach"));
  assert.ok(skills.some((skill) => skill.id === "growth-analysis"));
});

test("get education skill returns standard content", () => {
  const skill = education.getEducationSkill("writing-coach");
  assert.equal(skill.name, "写作教练");
  assert.match(skill.content, /评价标准/);
  assert.match(skill.content, /数据写入规则/);
});

test("get coaching policy returns the same education skill", () => {
  const policy = education.getCoachingPolicy("parent-coach");
  assert.equal(policy.id, "parent-coach");
  assert.match(policy.content, /不进行医学或心理诊断/);
});

test("build child context includes profile, records and growth", () => {
  store.seedIfEmpty();
  const context = education.buildChildContext("family_001", "child_001");
  assert.equal(context.child.name, "乔乔");
  assert.ok(context.recent_records.length > 0);
  assert.ok(context.growth.length > 0);
});
