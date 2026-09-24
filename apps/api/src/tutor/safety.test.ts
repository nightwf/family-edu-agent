import { describe, expect, it, vi } from "vitest";
import { validateReferences, scanInput, scanOutput } from "./safety.js";

const wrongCount = vi.fn();
const questionCount = vi.fn();

vi.mock("../prisma.js", () => ({
  prisma: {
    wrongQuestionEntry: { count: (...args: unknown[]) => wrongCount(...args) },
    question: { count: (...args: unknown[]) => questionCount(...args) },
    tutorSafetyEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

describe("L1 输入侧", () => {
  it("正常消息放行", () => {
    expect(scanInput("这道题怎么做").ok).toBe(true);
  });

  it("空消息拦截", () => {
    expect(scanInput("   ")).toMatchObject({ ok: false, action: "blocked" });
  });

  it("超长消息拦截", () => {
    const result = scanInput("字".repeat(2001));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("过长");
  });

  it("自伤相关表达拦截", () => {
    expect(scanInput("我不想活了")).toMatchObject({ ok: false, reason: "自伤相关表达" });
  });

  it("索要联系方式拦截", () => {
    expect(scanInput("你加我微信好吗").ok).toBe(false);
  });
});

describe("L3 输出侧", () => {
  it("正常回答放行", () => {
    expect(scanOutput("我们先看看题目条件")).toMatchObject({ ok: true, action: "pass" });
  });

  it("羞辱式表达被替换，不是原样放行", () => {
    const result = scanOutput("你怎么这么笨");
    expect(result.ok).toBe(false);
    expect(result.action).toBe("replaced");
    expect(result.text).not.toContain("笨");
  });

  it("比较式表达被替换", () => {
    expect(scanOutput("你看隔壁小明").action).toBe("replaced");
  });

  it("空回答不报错", () => {
    expect(scanOutput("")).toMatchObject({ ok: true });
  });
});

describe("引用校验", () => {
  it("没有引用时直接通过", async () => {
    expect(await validateReferences("family-1", {})).toEqual({ ok: true });
  });

  it("引用的错题都属于本家庭时通过", async () => {
    wrongCount.mockResolvedValue(2);
    const result = await validateReferences("family-1", { wrongQuestionIds: ["w1", "w2"] });
    expect(result.ok).toBe(true);
    expect(wrongCount).toHaveBeenCalledWith({ where: { familyId: "family-1", id: { in: ["w1", "w2"] } } });
  });

  it("引用了别家错题时判定失败", async () => {
    wrongCount.mockResolvedValue(1);
    const result = await validateReferences("family-1", { wrongQuestionIds: ["w1", "w2"] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("错题");
  });

  it("引用了别家题目时判定失败", async () => {
    questionCount.mockResolvedValue(0);
    const result = await validateReferences("family-1", { questionIds: ["q1"] });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("题目");
  });
});
