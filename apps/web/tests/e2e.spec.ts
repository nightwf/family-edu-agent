import { test, expect } from "@playwright/test";

test("register, open pages and verify mobile layout", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "邀请码注册" }).click();
  const email = `e2e-${Date.now()}@example.com`;
  await page.locator('input[placeholder="邀请码"]').fill("HE-2026");
  await page.locator('input[placeholder="邮箱"]').fill(email);
  await page.locator('input[placeholder="密码"]').fill("123456");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByText("成长记录")).toBeVisible();

  for (const name of ["学生", "报告成长", "教材", "作业", "知识库", "设置"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth");
  expect(overflow).toBe(false);
});
