import { describe, expect, it, vi, beforeEach } from "vitest";
const upsert = vi.fn().mockResolvedValue({});
vi.mock("./prisma.js", () => ({
    prisma: {
        skillVersion: { upsert },
        familySkillProfile: {},
        policyChange: {},
    },
}));
vi.mock("./education.js", () => ({
    listEducationSkills: () => [
        { id: "writing-coach", name: "写作教练", file: "writing-coach.md" },
        { id: "reading-coach", name: "阅读教练", file: "reading-coach.md" },
        { id: "homework-planner", name: "作业规划", file: "homework-planner.md" },
        { id: "parent-coach", name: "家长教练", file: "parent-coach.md" },
        { id: "growth-analysis", name: "成长分析", file: "growth-analysis.md" },
    ],
    getEducationSkill: () => ({ content: "# test" }),
}));
const { ensureBaseSkillVersions } = await import("./personalization.js");
describe("personalization", () => {
    beforeEach(() => upsert.mockClear());
    it("creates base skill versions for every education skill", async () => {
        await ensureBaseSkillVersions();
        expect(upsert).toHaveBeenCalledTimes(5);
    });
});
