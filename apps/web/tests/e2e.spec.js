import { test, expect } from "@playwright/test";

test("question bank workflow, family isolation and mobile layout", async ({ page, request }) => {
  await page.goto("./", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "邀请码注册" }).click();
  const stamp = Date.now();
  const email = `e2e-question-${stamp}@example.com`;
  await page.locator('input[placeholder="邀请码"]').fill("HE-2026");
  await page.locator('input[placeholder="邮箱"]').fill(email);
  await page.locator('input[placeholder="密码"]').fill("123456");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByText("成长记录")).toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem("familyEduToken"));
  expect(token).toBeTruthy();
  const api = (path) => new URL(`api/${path}`, page.url()).toString();
  const headers = { Authorization: `Bearer ${token}` };

  const childResponse = await request.post(api("children"), { headers, data: { name: "题库测试学生", age: 10, grade: "四年级", subjects: ["数学"] } });
  expect(childResponse.ok()).toBeTruthy();
  const child = await childResponse.json();

  const typeResponse = await request.post(api("question-types"), {
    headers,
    data: {
      subject: "数学", grade: "四年级", name: "两步应用题", description: "先确定中间量，再计算最终结果",
      knowledge_points: ["整数四则运算"], invariants: ["必须包含两个有依赖关系的步骤"], variable_parameters: ["数量", "生活场景"],
      generation_rule: "保持两步依赖关系，逐步增加干扰信息",
      mastery_criteria: { minScore: 80, minAttempts: 5, minVariations: 3, requireTransfer: true, requireDelayedReview: true, delayedHours: 24 },
    },
  });
  expect(typeResponse.ok()).toBeTruthy();
  const questionType = await typeResponse.json();

  const questionResponse = await request.post(api("questions"), {
    headers,
    data: {
      question_type_id: questionType.id,
      stem: "图书馆上午借出 24 本书，下午借出的是上午的 2 倍，一共借出多少本？",
      format: "calculation", answer: "72 本", solution: "先算下午借出 48 本，再计算 24 + 48 = 72 本。",
      difficulty: "basic", variation_type: "structure", source: "e2e",
    },
  });
  expect(questionResponse.ok()).toBeTruthy();
  const question = await questionResponse.json();

  const attemptResponse = await request.post(api("question-attempts"), {
    headers,
    data: { child_id: child.id, question_id: question.id, student_answer: "72 本", is_correct: true, score: 100, used_hint: false },
  });
  expect(attemptResponse.ok()).toBeTruthy();
  expect((await attemptResponse.json()).mastery.status).toBe("learning");

  const secondFamily = await request.post(api("auth/register"), {
    data: { inviteCode: "HE-2026", email: `e2e-isolation-${stamp}@example.com`, password: "123456" },
  });
  expect(secondFamily.ok()).toBeTruthy();
  const secondToken = (await secondFamily.json()).token;
  const forbidden = await request.get(api(`question-types/${questionType.id}`), { headers: { Authorization: `Bearer ${secondToken}` } });
  expect(forbidden.status()).toBe(404);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "题库", exact: true }).click();
  await expect(page.getByRole("button", { name: "录入题目", exact: true })).toHaveCount(0);
  await expect(page.getByText(question.stem)).toBeVisible();
  await page.getByRole("button", { name: "题型分类", exact: true }).click();
  await expect(page.getByText("两步应用题").first()).toBeVisible();
  await page.getByRole("button", { name: "学生掌握", exact: true }).click();
  await expect(page.locator("tbody").getByText("学习中").first()).toBeVisible();
  await page.screenshot({ path: "/tmp/family-edu-question-desktop.png", fullPage: true });

  for (const name of ["学生", "报告成长", "教材", "题库", "作业", "知识库", "设置"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "题库", exact: true }).first().click();
  await expect(page.getByText(question.stem)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: "/tmp/family-edu-question-mobile.png", fullPage: true });

  await request.delete(api(`children/${child.id}`), { headers });
  await request.delete(api(`questions/${question.id}`), { headers });
  await request.delete(api(`question-types/${questionType.id}`), { headers });
});
