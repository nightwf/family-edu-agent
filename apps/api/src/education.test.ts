import { describe, expect, it } from "vitest";
import { listEducationSkills, getEducationSkill } from "./education.js";

describe("education skills", () => {
  it("lists five education skills", () => {
    const skills = listEducationSkills();
    expect(skills).toHaveLength(5);
    expect(skills.some((skill) => skill.id === "writing-coach")).toBe(true);
  });

  it("loads skill content and policy", () => {
    const skill = getEducationSkill("parent-coach");
    expect(skill?.name).toBe("家长教练");
    expect(skill?.content).toContain("不进行医学或心理诊断");
  });
});
