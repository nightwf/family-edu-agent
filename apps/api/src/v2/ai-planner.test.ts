import { describe, expect, it } from "vitest";
import { parseAiPlanOutput } from "./ai-planner.js";

const valid = {
  summary: "先稳定基础，再安排迁移练习",
  rationale: "看图列式近期重复出错，且复测已到期",
  goals: [
    { title: "稳定看图列式", objective: "能独立完成基础和变式题", criteria: { accuracy: ">=80%" } },
    { title: "改善检查习惯", objective: "完成后主动检查等量关系", criteria: { checks: 5 } },
  ],
  recommended_goal_index: 0,
  week_items: [
    { type: "CHILD_TASK", title: "基础练习", description: "完成 3 题", estimated_minutes: 15, due_day: 1 },
    { type: "PARENT_ACTION", title: "观察列式过程", description: "只记录不代答", estimated_minutes: 10, due_day: 3 },
    { type: "RETEST", title: "延迟复测", description: "独立完成迁移题", estimated_minutes: 15, due_day: 6 },
  ],
};

describe("AI planner structured output", () => {
  it("accepts a fenced JSON response and preserves canonical plan item types", () => {
    const result = parseAiPlanOutput(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
    expect(result.goals).toHaveLength(2);
    expect(result.week_items.map((item) => item.type)).toEqual(["CHILD_TASK", "PARENT_ACTION", "RETEST"]);
  });

  it("rejects plans that omit enough evidence-based alternatives", () => {
    expect(() => parseAiPlanOutput(JSON.stringify({ ...valid, goals: valid.goals.slice(0, 1) }))).toThrow("字段不完整");
  });

  it("rejects invented task types instead of silently storing them", () => {
    const invalid = { ...valid, week_items: valid.week_items.map((item, index) => index ? item : { ...item, type: "STUDY" }) };
    expect(() => parseAiPlanOutput(JSON.stringify(invalid))).toThrow("字段不完整");
  });
});
