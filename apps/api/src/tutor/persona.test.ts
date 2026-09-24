import { describe, expect, it, vi } from "vitest";

const findUniqueFamily = vi.fn();
const findFirstChild = vi.fn();
const getEffectiveSkill = vi.fn();

vi.mock("../prisma.js", () => ({
  prisma: {
    family: { findUnique: (...args: unknown[]) => findUniqueFamily(...args) },
    child: { findFirst: (...args: unknown[]) => findFirstChild(...args) },
  },
}));

vi.mock("../personalization.js", () => ({
  getEffectiveSkill: (...args: unknown[]) => getEffectiveSkill(...args),
}));

const { renderTutorPrompt, buildTutorPersona, teachingRules } = await import("./persona.js");

describe("人格渲染（纯函数）", () => {
  it("把家庭设置写进提示词，严格度与沟通风格都在", () => {
    const prompt = renderTutorPrompt({
      persona: "child_tutor",
      childName: "JOJO",
      grade: "三年级",
      settings: { philosophy: "以引导和鼓励为主", communicationStyle: "温和", strictness: "宽松", parentGoals: ["养成阅读习惯"] },
      resolution: "family",
    });
    expect(prompt).toContain("JOJO");
    expect(prompt).toContain("三年级");
    expect(prompt).toContain("以引导和鼓励为主");
    expect(prompt).toContain("宽松");
    expect(prompt).toContain("养成阅读习惯");
    expect(prompt).toContain("家庭设置");
  });

  it("孩子级设置会覆盖家庭级，并标出来源", () => {
    const prompt = renderTutorPrompt({
      persona: "child_tutor",
      childName: "JOJO",
      settings: { philosophy: "严格训练", strictness: "严格", childNotes: "注意力容易分散，单次不要超过 10 分钟" },
      resolution: "child",
    });
    expect(prompt).toContain("严格训练");
    expect(prompt).toContain("孩子个体设置");
    expect(prompt).toContain("注意力容易分散");
  });

  it("没配置时给出可读的默认值，而不是空白", () => {
    const prompt = renderTutorPrompt({ persona: "child_tutor", settings: {} });
    expect(prompt).toContain("引导和鼓励为主（默认）");
    expect(prompt).toContain("系统默认");
  });

  it("五条教学硬规则全部在提示词里", () => {
    const prompt = renderTutorPrompt({ persona: "child_tutor", settings: {} });
    for (const rule of teachingRules("child_tutor")) {
      expect(prompt).toContain(rule);
    }
    expect(prompt).toContain("不直接给答案");
    expect(prompt).toContain("一次只教一个点");
  });

  it("家长视角额外要求给可执行动作", () => {
    const prompt = renderTutorPrompt({ persona: "parent_coach", settings: {} });
    expect(prompt).toContain("家长");
    expect(prompt).toContain("可执行的动作与话术");
  });

  it("性别影响称呼，未设置时不出现称呼", () => {
    expect(renderTutorPrompt({ persona: "child_tutor", gender: "female", settings: {} })).toContain("女孩");
    expect(renderTutorPrompt({ persona: "child_tutor", gender: "male", settings: {} })).toContain("男孩");
    expect(renderTutorPrompt({ persona: "child_tutor", settings: {} })).not.toContain("- 称呼：");
  });
});

describe("人格取数", () => {
  it("优先用孩子级解析结果，并把技能节选带上", async () => {
    findUniqueFamily.mockResolvedValue({ educationPhilosophy: "家庭理念", communicationStyle: "家庭风格", strictness: "家庭严格", parentGoals: [] });
    findFirstChild.mockResolvedValue({ id: "child-1", name: "JOJO", grade: "三年级", gender: "male" });
    getEffectiveSkill.mockResolvedValue({
      resolution: "child",
      resolved_settings: { philosophy: "孩子理念", communicationStyle: "孩子风格", strictness: "严格", parentGoals: ["目标A"] },
      child_profile: { notes: "粗心" },
      recommended_methods: [{ name: "费曼学习法", category: "理解" }],
      skill: { content: "技能正文" },
    });

    const prompt = await buildTutorPersona({ familyId: "family-1", persona: "child_tutor", childId: "child-1" });
    expect(prompt).toContain("孩子理念");
    expect(prompt).toContain("严格");
    expect(prompt).toContain("粗心");
    expect(prompt).toContain("费曼学习法");
    expect(prompt).toContain("技能正文");
    expect(prompt).toContain("孩子个体设置");
    // 取技能时必须带上 child_id，否则拿不到孩子级配置
    expect(getEffectiveSkill).toHaveBeenCalledWith("family-1", "growth-analysis", "child-1");
  });

  it("孩子级没配置时回落到家庭设置", async () => {
    findUniqueFamily.mockResolvedValue({ educationPhilosophy: "家庭理念", communicationStyle: "家庭风格", strictness: "适中", parentGoals: ["家庭目标"] });
    findFirstChild.mockResolvedValue({ id: "child-1", name: "JOJO", grade: "三年级", gender: "male" });
    getEffectiveSkill.mockResolvedValue({
      resolution: "family",
      resolved_settings: { philosophy: "家庭理念", communicationStyle: "家庭风格", strictness: "适中", parentGoals: ["家庭目标"] },
      child_profile: null,
      recommended_methods: [],
      skill: { content: "" },
    });

    const prompt = await buildTutorPersona({ familyId: "family-1", persona: "child_tutor", childId: "child-1" });
    expect(prompt).toContain("家庭理念");
    expect(prompt).toContain("家庭设置");
  });

  it("技能解析失败时不崩，回落到家庭表字段", async () => {
    findUniqueFamily.mockResolvedValue({ educationPhilosophy: "兜底理念", communicationStyle: null, strictness: null, parentGoals: null });
    findFirstChild.mockResolvedValue(null);
    getEffectiveSkill.mockRejectedValue(new Error("技能文件缺失"));

    const prompt = await buildTutorPersona({ familyId: "family-1", persona: "child_tutor", childId: null });
    expect(prompt).toContain("兜底理念");
    expect(prompt).toContain("未指定");
  });
});
