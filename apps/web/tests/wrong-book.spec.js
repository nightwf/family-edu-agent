import { test, expect } from "@playwright/test";

test("wrong-book evidence, paper, plan, family isolation and responsive UI", async ({ page, request }) => {
  test.setTimeout(90000);
  const stamp = Date.now();
  const email = `e2e-wrong-${stamp}@example.com`;
  await page.goto("./", { waitUntil: "networkidle" });
  const api = (path) => new URL(`api/${path}`, page.url()).toString();
  const registration = await request.post(api("auth/register"), { data: { inviteCode: "HE-2026", email, password: "123456" } });
  expect(registration.ok()).toBeTruthy();
  const token = (await registration.json()).token;
  const headers = { Authorization: `Bearer ${token}` };

  const childResponse = await request.post(api("children"), { headers, data: { name: "错题测试学生", age: 11, grade: "五年级", subjects: ["数学"] } });
  const child = await childResponse.json();
  const typeResponse = await request.post(api("question-types"), { headers, data: {
    subject: "数学", grade: "五年级", name: "分数单位换算", knowledge_points: ["分数", "单位换算"],
    invariants: ["先统一单位再运算"], variable_parameters: ["单位", "数量", "场景"], generation_rule: "覆盖条件变化、易错点与迁移场景",
  } });
  expect(typeResponse.ok()).toBeTruthy();
  const questionType = await typeResponse.json();

  const questionPayloads = [
    ["3/4 米等于多少厘米？", "75 厘米", "original", "basic"],
    ["0.6 米等于多少厘米？", "60 厘米", "same_structure", "basic"],
    ["125 厘米等于多少米？", "1.25 米", "changed_condition", "advanced"],
    ["一根 2 米长的绳子剪去 75 厘米，还剩多少米？", "1.25 米", "transfer", "transfer"],
    ["1.4 千米等于多少米？", "1400 米", "delayed_review", "review"],
  ];
  const questions = [];
  for (const [stem, answer, variation, difficulty] of questionPayloads) {
    const response = await request.post(api("questions"), { headers, data: {
      question_type_id: questionType.id, stem, answer, solution: "统一单位后计算。", format: "calculation",
      variation_type: variation, difficulty, generation_rule_version: "1.0.0", source: "e2e",
    } });
    expect(response.ok()).toBeTruthy();
    questions.push(await response.json());
  }

  const wrongAttempt = await request.post(api("question-attempts"), { headers, data: {
    child_id: child.id, question_id: questions[0].id, student_answer: "34 厘米", is_correct: false, score: 0,
    error_reason: "把分数直接拼成两位数", error_category: "单位换算规则不清", evaluation: "需要先理解四分之三的含义", save_to_wrong_book: true,
    attempted_at: "2026-08-14T08:00:00.000Z", session_id: "wrong-session",
  } });
  expect(wrongAttempt.ok()).toBeTruthy();
  const wrongMastery = (await wrongAttempt.json()).wrong_question_mastery.wrong_question;
  expect(wrongMastery.status).toBe("strengthening");
  const wrongId = wrongMastery.id;

  const contextResponse = await request.post(api("wrong-questions/practice-context"), { headers, data: { wrong_question_id: wrongId, count: 5 } });
  expect(contextResponse.ok()).toBeTruthy();
  expect((await contextResponse.json()).generation_requirements.output_schema.source_question_id).toBe(questions[0].id);

  const attempts = [
    [questions[0], "2026-08-15T08:00:00.000Z", "session-1", true],
    [questions[1], "2026-08-15T08:10:00.000Z", "session-1", false],
    [questions[2], "2026-08-15T08:20:00.000Z", "session-1", false],
    [questions[3], "2026-08-15T08:30:00.000Z", "session-1", false],
    [questions[4], "2026-08-17T08:00:00.000Z", "session-2", false],
  ];
  for (const [question, attemptedAt, sessionId, original] of attempts) {
    const response = await request.post(api("question-attempts"), { headers, data: {
      child_id: child.id, question_id: question.id, wrong_question_id: wrongId, student_answer: question.answer,
      is_correct: true, score: 100, is_independent: true, is_original_correction: original,
      variation_type: question.variationType, session_id: sessionId, attempted_at: attemptedAt,
    } });
    expect(response.ok()).toBeTruthy();
  }
  const masteredResponse = await request.post(api(`wrong-questions/${wrongId}/recalculate`), { headers });
  expect(masteredResponse.ok()).toBeTruthy();
  expect((await masteredResponse.json()).wrong_question.calculatedStatus).toBe("mastered");

  const paperResponse = await request.post(api("practice-papers"), { headers, data: {
    child_id: child.id, title: "分数单位换算专项练习", subject: "数学", objective: "完成从基础换算到新场景迁移",
    estimated_minutes: 20, total_score: 40, questions: questions.slice(1).map((question, index) => ({ question_id: question.id, wrong_question_id: wrongId, allow_variant: true, sequence: index + 1, score: 10, purpose: question.variationType })),
  } });
  expect(paperResponse.ok()).toBeTruthy();
  const paper = await paperResponse.json();

  const planResponse = await request.post(api("remediation-plans"), { headers, data: {
    child_id: child.id, title: "单位换算错题巩固计划", subject: "数学", diagnosis: { issue: "单位关系与分数意义未连接" },
    objectives: ["能独立完成双向换算", "能在应用题中迁移"], strategy: "先模型解释，再变式练习，最后延迟复测",
    tasks: [
      { wrong_question_id: wrongId, question_type_id: questionType.id, title: "完成原题订正", task_type: "correction", sequence: 1 },
      { wrong_question_id: wrongId, question_type_id: questionType.id, title: "完成专项试卷", task_type: "practice", sequence: 2 },
    ],
  } });
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json();

  const wrongAgain = await request.post(api("question-attempts"), { headers, data: {
    child_id: child.id, question_id: questions[0].id, wrong_question_id: wrongId, student_answer: "34 厘米", is_correct: false, score: 0,
    is_independent: true, error_reason: "延迟复习再次混淆", attempted_at: "2026-08-18T08:00:00.000Z", session_id: "session-3",
  } });
  expect(wrongAgain.ok()).toBeTruthy();
  expect((await wrongAgain.json()).wrong_question_mastery.wrong_question.calculatedStatus).toBe("needs_review");

  const secondRegistration = await request.post(api("auth/register"), { data: { inviteCode: "HE-2026", email: `e2e-wrong-isolation-${stamp}@example.com`, password: "123456" } });
  const secondToken = (await secondRegistration.json()).token;
  const forbidden = await request.get(api(`wrong-questions/${wrongId}`), { headers: { Authorization: `Bearer ${secondToken}` } });
  expect(forbidden.status()).toBe(404);

  await page.addInitScript((value) => localStorage.setItem("familyEduToken", value), token);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "错题本", exact: true }).click();
  await expect(page.getByText(questions[0].stem)).toBeVisible();
  await page.getByText(questions[0].stem).click();
  await expect(page.getByText("掌握证据")).toBeVisible();
  await page.screenshot({ path: "/tmp/family-edu-wrong-detail.png", fullPage: true });
  await page.getByTitle("关闭").click();
  await page.getByRole("button", { name: "掌握进度", exact: true }).click();
  await expect(page.getByText("需复习").first()).toBeVisible();
  await page.getByRole("button", { name: "练习试卷", exact: true }).click();
  await expect(page.getByText(paper.title)).toBeVisible();
  await page.getByRole("button", { name: "查看与打印" }).click();
  await page.getByRole("button", { name: "家长版", exact: true }).click();
  await expect(page.getByText("答案与解析").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/family-edu-paper-parent.png", fullPage: true });
  await page.getByTitle("关闭").click();
  await page.getByRole("button", { name: "教学规划", exact: true }).click();
  await expect(page.getByText(plan.title)).toBeVisible();
  await page.screenshot({ path: "/tmp/family-edu-wrong-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "错题列表", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "/tmp/family-edu-wrong-mobile.png", fullPage: true });

  await request.delete(api(`children/${child.id}`), { headers });
  for (const question of questions) await request.delete(api(`questions/${question.id}`), { headers });
  await request.delete(api(`question-types/${questionType.id}`), { headers });
});
