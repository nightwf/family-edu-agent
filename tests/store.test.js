import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "family-edu-test-"));
process.env.DB_FILE = path.join(tempDir, "db.json");
process.env.UPLOAD_DIR = path.join(tempDir, "uploads");

const store = await import("../src/store.js");
let registeredFamilyId;

test("seed creates demo family, children, records and textbooks", () => {
  store.seedIfEmpty();
  assert.equal(store.listChildren("family_001").length, 2);
  assert.ok(store.listTextbooks("family_001").length >= 3);
  assert.equal(store.getFamilySummary("family_001").record_count, 13);
});

test("register family requires invite code and returns a user", () => {
  const result = store.registerFamily({
    email: "pm.test@example.com",
    password: "123456",
    inviteCode: "HE-2026",
  });
  assert.equal(result.user.email, "pm.test@example.com");
  assert.equal(result.family.invite_code, "HE-2026");
  registeredFamilyId = result.family.id;
  assert.throws(() => store.registerFamily({ email: "bad@example.com", password: "123456", inviteCode: "BAD" }), /邀请码无效/);
});

test("create child, generate report and growth series", () => {
  const child = store.createChild(registeredFamilyId, {
    name: "测试孩子",
    age: 8,
    grade: "二年级",
    subjects: ["语文", "数学"],
    textbook_version: "人教版 · 二年级上册",
  });
  store.createRecord({
    family_id: registeredFamilyId,
    child_id: child.id,
    type: "writing",
    date: "2026-08-13",
    title: "测试日记",
    score: 75,
  });
  const report = store.generateReport(child.id, "weekly");
  assert.equal(report.child_id, child.id);
  assert.ok(store.growthSeries(child.id).length >= 1);
});

test("create, update and delete textbook", () => {
  const textbook = store.createTextbook({
    family_id: "family_001",
    child_id: "child_001",
    title: "测试教材",
    subject: "语文",
    grade: "三年级",
  });
  const updated = store.updateTextbook(textbook.id, { title: "测试教材改版", status: "syncing" });
  assert.equal(updated.title, "测试教材改版");
  store.deleteTextbook(textbook.id);
  assert.equal(store.getTextbook(textbook.id), null);
});

test("create, list and delete knowledge item", () => {
  const item = store.createKnowledgeItem({
    family_id: "family_001",
    child_id: "child_001",
    kind: "summary",
    title: "WorkBuddy 生成的阶段总结",
    content: "这是 WorkBuddy 写回项目的总结内容。",
    source: "workbuddy",
  });
  assert.ok(store.listKnowledgeItems("family_001").some((entry) => entry.id === item.id));
  store.deleteKnowledgeItem(item.id);
  assert.equal(store.listKnowledgeItems("family_001").some((entry) => entry.id === item.id), false);
});

test("create, list and complete homework", () => {
  const homework = store.createHomework({
    family_id: "family_001",
    child_id: "child_001",
    subject: "数学",
    title: "练习册 P32-33",
    estimated_minutes: 30,
    due_date: "2026-08-13",
  });
  assert.equal(homework.kind, "homework");
  assert.ok(store.listHomework("child_001").some((item) => item.id === homework.id));
  const completed = store.completeHomework(homework.id);
  assert.equal(completed.status, "done");
  assert.ok(completed.completed_at);
});

test("sync local payload merges records", () => {
  const result = store.syncLocalPayload({
    family_id: "family_001",
    records: [{ id: "record_sync_1", child_id: "child_001", type: "reading", date: "2026-08-13", title: "本地同步阅读", score: 80 }],
  });
  assert.equal(result.synced, true);
  assert.ok(store.listRecords("child_001").some((item) => item.id === "record_sync_1"));
});
