import { beforeEach, describe, expect, it, vi } from "vitest";
const childFindFirst = vi.fn();
const familyFindUnique = vi.fn();
const familySkillFindUnique = vi.fn();
const familySkillFindMany = vi.fn();
const childSkillFindUnique = vi.fn();
const childSkillFindMany = vi.fn();
const childSkillUpsert = vi.fn();
const childSkillDelete = vi.fn();
const policyChangeCreate = vi.fn();
vi.mock("./prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        family: { findUnique: familyFindUnique },
        familySkillProfile: { findUnique: familySkillFindUnique, findMany: familySkillFindMany },
        childSkillProfile: {
            findUnique: childSkillFindUnique,
            findMany: childSkillFindMany,
            upsert: childSkillUpsert,
            delete: childSkillDelete,
        },
        policyChange: { create: policyChangeCreate },
    },
}));
vi.mock("./education.js", () => ({
    listEducationSkills: () => [
        { id: "writing-coach", name: "写作教练", description: "", ages: "", scenario: "", file: "writing-coach.md" },
    ],
    getEducationSkill: (skillId) => skillId === "writing-coach"
        ? { id: "writing-coach", name: "写作教练", description: "", ages: "", scenario: "", file: "writing-coach.md", content: "# 写作教练" }
        : null,
}));
const { getEffectiveSkill, getChildProfile, updateChildProfile, clearChildProfile, listChildProfiles } = await import("./personalization.js");
describe("教育方式按孩子维度分层", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        childFindFirst.mockResolvedValue({ id: "child-1", name: "JOJO", familyId: "family-1" });
        familyFindUnique.mockResolvedValue({
            id: "family-1",
            educationPhilosophy: "习惯优先",
            communicationStyle: "鼓励为主",
            strictness: "宽松",
        });
        familySkillFindUnique.mockResolvedValue(null);
        familySkillFindMany.mockResolvedValue([]);
        childSkillFindUnique.mockResolvedValue(null);
        childSkillFindMany.mockResolvedValue([]);
        policyChangeCreate.mockResolvedValue({ id: "change-1" });
    });
    it("不传 child_id 时保持家庭级行为，不读取孩子级配置", async () => {
        const effective = await getEffectiveSkill("family-1", "writing-coach");
        expect(childSkillFindUnique).not.toHaveBeenCalled();
        expect(effective?.resolution).toBe("family");
        expect(effective?.resolved_settings).toMatchObject({
            philosophy: "习惯优先",
            communicationStyle: "鼓励为主",
            strictness: "宽松",
        });
        expect(effective?.child_id).toBeNull();
    });
    it("家庭和孩子都没有配置时回落到默认值", async () => {
        familyFindUnique.mockResolvedValue({ id: "family-1" });
        const effective = await getEffectiveSkill("family-1", "writing-coach", "child-1");
        expect(effective?.resolution).toBe("default");
        expect(effective?.resolved_settings).toEqual({
            philosophy: "以引导和鼓励为主",
            communicationStyle: "温和直接",
            strictness: "适中",
            parentGoals: [],
        });
    });
    it("孩子级配置逐项覆盖家庭级配置", async () => {
        childSkillFindUnique.mockResolvedValue({
            id: "csp-1",
            childId: "child-1",
            skillId: "writing-coach",
            active: true,
            philosophy: "自主探索",
            communicationStyle: null,
            strictness: "严格",
            parentGoals: ["每天写一段"],
            notes: "写字慢，需要先口述再动笔",
        });
        const effective = await getEffectiveSkill("family-1", "writing-coach", "child-1");
        expect(effective?.resolution).toBe("child");
        expect(effective?.resolved_settings).toEqual({
            philosophy: "自主探索",
            communicationStyle: "鼓励为主",
            strictness: "严格",
            parentGoals: ["每天写一段"],
        });
        expect(effective?.child_overrides).toEqual(["philosophy", "strictness", "parentGoals"]);
        expect(effective?.effective_content).toContain("孩子个体差异配置");
        expect(effective?.effective_content).toContain("写字慢，需要先口述再动笔");
    });
    it("孩子没配置时自动继承家庭设置", async () => {
        const effective = await getEffectiveSkill("family-1", "writing-coach", "child-1");
        expect(effective?.resolution).toBe("family");
        expect(effective?.child_profile).toBeNull();
        expect(effective?.resolved_settings).toMatchObject({ philosophy: "习惯优先", strictness: "宽松" });
        expect(effective?.effective_content).not.toContain("孩子个体差异配置");
    });
    it("停用的孩子级配置不生效", async () => {
        childSkillFindUnique.mockResolvedValue({
            id: "csp-1",
            childId: "child-1",
            skillId: "writing-coach",
            active: false,
            philosophy: "自主探索",
            parentGoals: [],
        });
        const effective = await getEffectiveSkill("family-1", "writing-coach", "child-1");
        expect(effective?.resolution).toBe("family");
        expect(effective?.resolved_settings).toMatchObject({ philosophy: "习惯优先" });
    });
    it("读取别的家庭的孩子会被拒绝", async () => {
        childFindFirst.mockResolvedValue(null);
        await expect(getChildProfile("family-1", "child-other", "writing-coach")).rejects.toThrow("学生不存在或不属于当前家庭");
        await expect(getEffectiveSkill("family-1", "writing-coach", "child-other")).rejects.toThrow("学生不存在或不属于当前家庭");
    });
    it("写入孩子级配置时记录孩子维度并带上 familyId", async () => {
        childSkillUpsert.mockImplementation(async ({ create, update }) => ({
            id: "csp-1",
            ...create,
            ...update,
        }));
        await updateChildProfile("family-1", "child-1", "writing-coach", {
            philosophy: "自主探索",
            parentGoals: ["每天写一段"],
        });
        expect(childSkillUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { childId_skillId: { childId: "child-1", skillId: "writing-coach" } },
            create: expect.objectContaining({ childId: "child-1", familyId: "family-1" }),
        }));
        expect(policyChangeCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ familyId: "family-1", childId: "child-1", type: "child_profile_update" }),
        }));
    });
    it("清空孩子级配置后回到继承家庭设置", async () => {
        childSkillFindUnique.mockResolvedValue({ id: "csp-1", childId: "child-1", skillId: "writing-coach", active: true });
        const result = await clearChildProfile("family-1", "child-1", "writing-coach");
        expect(result).toEqual({ ok: true });
        expect(childSkillDelete).toHaveBeenCalledWith({
            where: { childId_skillId: { childId: "child-1", skillId: "writing-coach" } },
        });
        expect(policyChangeCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ childId: "child-1", type: "child_profile_clear" }) }));
    });
    it("按孩子汇总每个 Skill 的最终生效设置", async () => {
        familySkillFindMany.mockResolvedValue([]);
        childSkillFindMany.mockResolvedValue([
            { id: "csp-1", childId: "child-1", skillId: "writing-coach", active: true, philosophy: "自主探索", parentGoals: [] },
        ]);
        const list = await listChildProfiles("family-1", "child-1");
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
            skill_id: "writing-coach",
            child_id: "child-1",
            child_name: "JOJO",
            inherits_family: false,
        });
        expect(list[0].effective_settings).toMatchObject({ philosophy: "自主探索", communicationStyle: "鼓励为主" });
        expect(list[0].inherited_from_family).toMatchObject({ philosophy: "习惯优先", communicationStyle: "鼓励为主" });
    });
});
