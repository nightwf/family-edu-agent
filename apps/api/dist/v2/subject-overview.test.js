import { beforeEach, describe, expect, it, vi } from "vitest";
const childFindFirst = vi.fn();
const masteryFindMany = vi.fn();
const wrongFindMany = vi.fn();
const attemptFindMany = vi.fn();
const homeworkFindMany = vi.fn();
const getLearningPriorities = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        studentQuestionTypeMastery: { findMany: masteryFindMany },
        wrongQuestionEntry: { findMany: wrongFindMany },
        questionAttempt: { findMany: attemptFindMany },
        homework: { findMany: homeworkFindMany },
    },
}));
vi.mock("./learning-engine.js", () => ({ getLearningPriorities }));
const { buildAdvice, buildSubjectRow, classifySubject, describeSubjectChange, getSubjectDetail, getSubjectOverview, rankSubjectRows } = await import("./subject-overview.js");
const NOW = new Date(Date.UTC(2026, 8, 19, 4));
function baseInput(overrides = {}) {
    return {
        subject: "数学",
        masteries: [],
        wrongItems: [],
        attempts7d: 0,
        attempts14d: 0,
        pendingHomework: [],
        signals: [],
        ...overrides,
    };
}
function mastery(overrides = {}) {
    return {
        name: "看图列式",
        score: 54,
        status: "learning",
        totalAttempts: 5,
        variationCount: 2,
        nextReviewAt: null,
        ...overrides,
    };
}
beforeEach(() => {
    vi.clearAllMocks();
});
describe("学科状态判定", () => {
    it("没有任何记录时标记为材料不足，而不是给一个假分数", () => {
        const result = classifySubject(baseInput(), NOW);
        expect(result.status).toBe("thin");
        expect(result.score).toBeNull();
    });
    it("存在重复出错信号时判定为需重点，并直接引用信号原因", () => {
        const result = classifySubject(baseInput({
            masteries: [mastery()],
            attempts14d: 6,
            signals: [{ type: "REPEATED_ERROR", reason: "看图列式重复出错 2 次", priority_score: 115 }],
        }), NOW);
        expect(result.status).toBe("focus");
        expect(result.reason).toContain("重复出错");
    });
    it("掌握度低于 60 判定为需重点", () => {
        const result = classifySubject(baseInput({ masteries: [mastery({ score: 42 })], attempts14d: 4 }), NOW);
        expect(result.status).toBe("focus");
    });
    it("复测到期判定为需重点", () => {
        const result = classifySubject(baseInput({
            masteries: [mastery({ score: 82, status: "basic", nextReviewAt: new Date(NOW.getTime() - 3_600_000) })],
            attempts14d: 5,
        }), NOW);
        expect(result.status).toBe("focus");
        expect(result.dueNames).toContain("看图列式");
    });
    it("最近有练习且无待处理问题时判定为进步中", () => {
        const result = classifySubject(baseInput({ masteries: [mastery({ score: 76, status: "basic" })], attempts7d: 3, attempts14d: 5 }), NOW);
        expect(result.status).toBe("progress");
    });
    it("有数据但无近期练习时判定为状态稳定", () => {
        const result = classifySubject(baseInput({ masteries: [mastery({ score: 76, status: "basic" })], attempts14d: 4 }), NOW);
        expect(result.status).toBe("steady");
    });
    it("已掌握却再次答错时不会算作进步", () => {
        const result = classifySubject(baseInput({
            masteries: [mastery({ score: 78, status: "needs_review" })],
            attempts7d: 3,
            attempts14d: 5,
        }), NOW);
        expect(result.status).not.toBe("progress");
    });
});
describe("学科掌握度与变化说明", () => {
    it("学科掌握度按练习次数加权", () => {
        const row = buildSubjectRow(baseInput({
            masteries: [
                mastery({ name: "A", score: 80, totalAttempts: 9 }),
                mastery({ name: "B", score: 30, totalAttempts: 1 }),
            ],
            attempts14d: 10,
        }), NOW);
        expect(row.mastery_score).toBe(75);
    });
    it("变化说明优先讲重复出错", () => {
        const text = describeSubjectChange(baseInput({
            masteries: [mastery()],
            wrongItems: [{ name: "看图列式", mistakeCount: 2, errorReason: "混淆总量与部分量", nextReviewAt: null }],
            attempts14d: 5,
        }), NOW);
        expect(text).toContain("重复出错 2 次");
        expect(text).toContain("混淆总量与部分量");
    });
    it("材料不足时明确说明无法判断", () => {
        expect(describeSubjectChange(baseInput(), NOW)).toContain("无法判断");
    });
});
describe("学科排序", () => {
    it("需重点排最前，稳定与材料不足排后面", () => {
        const rows = [
            { status: "thin", mastery_score: null },
            { status: "steady", mastery_score: 80 },
            { status: "focus", mastery_score: 54 },
            { status: "progress", mastery_score: 76 },
        ];
        expect(rankSubjectRows(rows).map((row) => row.status)).toEqual(["focus", "progress", "steady", "thin"]);
    });
    it("同为需重点时掌握度低的排前面", () => {
        const rows = [
            { status: "focus", mastery_score: 70 },
            { status: "focus", mastery_score: 42 },
        ];
        expect(rankSubjectRows(rows)[0].mastery_score).toBe(42);
    });
});
describe("规划建议由规则生成", () => {
    const criteria = { minScore: 80, minAttempts: 5, minVariations: 3, delayedHours: 24 };
    it("重复出错给出变式加迁移题，并带上题型通过标准", () => {
        const advice = buildAdvice({ type: "REPEATED_ERROR", label: "看图列式", reason: "重复出错 2 次", priority_score: 115 }, undefined, { solutionMethod: "先圈出总量再列式", masteryCriteria: criteria }, { subject: "数学" });
        expect(advice.action).toContain("变式题 3 道");
        expect(advice.method).toContain("先圈出总量");
        expect(advice.pass_criteria).toContain("80");
        expect(advice.retest).toContain("24");
        expect(advice.basis).toContain("重复出错");
    });
    it("复测到期给出短时复测安排", () => {
        const advice = buildAdvice({ type: "REVIEW_DUE", label: "乘法口诀", reason: "已到复测时间", priority_score: 90 }, undefined, { masteryCriteria: criteria }, { subject: "数学" });
        expect(advice.action).toContain("复测");
        expect(advice.estimated_minutes).toBe(5);
    });
    it("没有信号时回退到最薄弱题型，并给出默认教学方式", () => {
        const advice = buildAdvice(null, mastery({ name: "乘法口诀" }), undefined, { subject: "数学" });
        expect(advice.target).toBe("乘法口诀");
        expect(advice.action).toContain("基础练习");
        expect(advice.method).toContain("不直接给答案");
    });
});
describe("学科概览接口", () => {
    beforeEach(() => {
        childFindFirst.mockResolvedValue({ id: "c1", name: "JOJO", grade: "三年级", subjects: ["数学"] });
        wrongFindMany.mockResolvedValue([]);
        homeworkFindMany.mockResolvedValue([]);
    });
    it("没有记录的关注学科也会出现，并标记为材料不足", async () => {
        childFindFirst.mockResolvedValue({ id: "c1", name: "JOJO", grade: "三年级", subjects: ["语文", "数学", "英语", "科学"] });
        masteryFindMany.mockResolvedValue([
            { masteryScore: 54, status: "learning", totalAttempts: 5, variationCount: 2, nextReviewAt: null, questionType: { name: "看图列式", subject: "数学" } },
        ]);
        attemptFindMany.mockResolvedValue([
            { attemptedAt: new Date(NOW.getTime() - 86_400_000), questionType: { subject: "数学", name: "看图列式" } },
        ]);
        getLearningPriorities.mockResolvedValue({ signal_count: 0, planning_required: true, active_goal: null, priorities: [] });
        const overview = await getSubjectOverview("fam1", "c1", NOW);
        expect(overview.subjects).toHaveLength(4);
        expect(overview.subjects[0].subject).toBe("数学");
        expect(overview.subjects[0].status).toBe("focus");
        const thinSubjects = overview.subjects.filter((row) => row.status === "thin").map((row) => row.subject);
        expect(thinSubjects).toEqual(expect.arrayContaining(["语文", "英语", "科学"]));
        expect(overview.overall.metrics.subject_count).toBe(1);
    });
    it("按学科聚合掌握度、薄弱点和复测数量", async () => {
        masteryFindMany.mockResolvedValue([
            { masteryScore: 54, status: "learning", totalAttempts: 5, variationCount: 2, nextReviewAt: null, questionType: { name: "看图列式", subject: "数学" } },
            { masteryScore: 82, status: "basic", totalAttempts: 4, variationCount: 3, nextReviewAt: null, questionType: { name: "病句修改", subject: "语文" } },
        ]);
        attemptFindMany.mockResolvedValue([
            { attemptedAt: new Date(NOW.getTime() - 86_400_000), questionType: { subject: "数学", name: "看图列式" } },
            { attemptedAt: new Date(NOW.getTime() - 2 * 86_400_000), questionType: { subject: "数学", name: "看图列式" } },
            { attemptedAt: new Date(NOW.getTime() - 3 * 86_400_000), questionType: { subject: "语文", name: "病句修改" } },
        ]);
        getLearningPriorities.mockResolvedValue({
            signal_count: 1,
            planning_required: true,
            active_goal: { stage_goal_id: "g1", title: "提升数学" },
            priorities: [{
                    subject: "数学",
                    type: "REPEATED_ERROR",
                    label: "看图列式",
                    reason: "看图列式重复出错 2 次",
                    priority_score: 115,
                }],
        });
        const overview = await getSubjectOverview("fam1", "c1", NOW);
        expect(overview.overall.conclusion).toContain("数学");
        expect(overview.subjects[0].subject).toBe("数学");
        expect(overview.subjects[0].status).toBe("focus");
        expect(overview.subjects[1].status).toBe("progress");
        expect(overview.overall.metrics.subject_count).toBe(2);
        expect(overview.overall.planning_required).toBe(true);
    });
    it("学科详情返回判断、问题清单和规划建议", async () => {
        masteryFindMany.mockResolvedValue([
            {
                masteryScore: 54,
                status: "learning",
                totalAttempts: 5,
                independentAttempts: 3,
                variationCount: 2,
                nextReviewAt: new Date(NOW.getTime() + 86_400_000),
                questionType: {
                    name: "看图列式",
                    subject: "数学",
                    solutionMethod: "先圈出总量再列式",
                    standardSteps: ["读题", "圈总量"],
                    masteryCriteria: { minScore: 80, minAttempts: 5, minVariations: 3, delayedHours: 24 },
                },
            },
        ]);
        attemptFindMany.mockResolvedValue([
            { attemptedAt: new Date(NOW.getTime() - 86_400_000), questionType: { subject: "数学", name: "看图列式" } },
        ]);
        getLearningPriorities.mockResolvedValue({
            signal_count: 1,
            planning_required: true,
            active_goal: null,
            priorities: [{
                    subject: "数学",
                    type: "LOW_MASTERY",
                    label: "看图列式",
                    reason: "练习 5 次后掌握分仍只有 54",
                    priority_score: 95,
                }],
        });
        const detail = await getSubjectDetail("fam1", "c1", "数学", NOW);
        expect(detail.subject).toBe("数学");
        expect(detail.judgement).toContain("数学");
        expect(detail.gaps[0].name).toBe("看图列式");
        expect(detail.gaps[0].evidence).toContain("练习 5 次");
        expect(detail.advice.method).toContain("先圈出总量");
        expect(detail.advice.basis).toContain("掌握分");
    });
    it("没有这一科记录时返回 404 语义的错误", async () => {
        masteryFindMany.mockResolvedValue([]);
        attemptFindMany.mockResolvedValue([]);
        getLearningPriorities.mockResolvedValue({ signal_count: 0, planning_required: false, active_goal: null, priorities: [] });
        await expect(getSubjectDetail("fam1", "c1", "物理", NOW)).rejects.toThrow(/没有这一科/);
    });
});
