import { beforeEach, describe, expect, it, vi } from "vitest";
const questionTypeFindFirst = vi.fn();
const questionTypeFindMany = vi.fn();
const knowledgeNodeFindMany = vi.fn();
const typeLinkFindMany = vi.fn();
const typeLinkUpsert = vi.fn();
const typeLinkDeleteMany = vi.fn();
const questionLinkFindMany = vi.fn();
const questionLinkUpsert = vi.fn();
const attemptFindMany = vi.fn();
const stateFindUnique = vi.fn();
const stateFindMany = vi.fn();
const stateUpsert = vi.fn();
const masteryFindMany = vi.fn();
const wrongFindMany = vi.fn();
const relationFindMany = vi.fn();
const signalUpsert = vi.fn();
const signalFindFirst = vi.fn();
const signalFindMany = vi.fn();
const signalUpdate = vi.fn();
const childFindFirst = vi.fn();
const goalFindFirst = vi.fn();
const requestFindFirst = vi.fn();
const requestCreate = vi.fn();
const requestFindMany = vi.fn();
const requestUpdate = vi.fn();
const outcomeCreate = vi.fn();
const outcomeFindMany = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        questionType: { findFirst: questionTypeFindFirst, findMany: questionTypeFindMany },
        knowledgeNode: { findMany: knowledgeNodeFindMany },
        questionTypeKnowledgeNode: { findMany: typeLinkFindMany, upsert: typeLinkUpsert, deleteMany: typeLinkDeleteMany },
        questionKnowledgeNode: { findMany: questionLinkFindMany, upsert: questionLinkUpsert },
        questionAttempt: { findMany: attemptFindMany },
        childKnowledgeState: { findUnique: stateFindUnique, findMany: stateFindMany, upsert: stateUpsert },
        studentQuestionTypeMastery: { findMany: masteryFindMany },
        wrongQuestionEntry: { findMany: wrongFindMany },
        knowledgeRelation: { findMany: relationFindMany },
        learningSignal: { upsert: signalUpsert, findFirst: signalFindFirst, findMany: signalFindMany, update: signalUpdate },
        child: { findFirst: childFindFirst },
        stageGoal: { findFirst: goalFindFirst },
        planningRequest: { findFirst: requestFindFirst, create: requestCreate, findMany: requestFindMany, update: requestUpdate },
        recommendationOutcome: { create: outcomeCreate, findMany: outcomeFindMany },
    },
}));
const { aggregateKnowledgeScore, detectLearningSignals, ensurePlanningRequest, getLearningPriorities, rankLearningPriorities, refreshKnowledgeStateFromAttempt, resolveLearningSignal, syncLearningSignals, } = await import("./learning-engine.js");
const NOW = new Date(Date.UTC(2026, 8, 19, 4));
function attempt(options) {
    return {
        isCorrect: options.correct ?? true,
        score: null,
        usedHint: options.usedHint ?? false,
        attemptedAt: new Date(NOW.getTime() - options.daysAgo * 86_400_000),
        variationType: options.variationType ?? null,
        difficulty: options.difficulty ?? "basic",
    };
}
beforeEach(() => {
    vi.clearAllMocks();
});
describe("知识点掌握聚合", () => {
    it("单次答对不能判定为已掌握", () => {
        const result = aggregateKnowledgeScore([attempt({ daysAgo: 1 })], undefined, null, NOW);
        expect(result.status).toBe("LEARNING");
        expect(result.score).toBeLessThan(80);
    });
    it("独立作答、多变式、迁移题和延迟复测齐备后才判定已掌握", () => {
        const attempts = [
            attempt({ daysAgo: 10, variationType: "same_structure" }),
            attempt({ daysAgo: 8, variationType: "changed_condition" }),
            attempt({ daysAgo: 7, variationType: "error_targeted" }),
            attempt({ daysAgo: 6, variationType: "transfer" }),
            attempt({ daysAgo: 5, variationType: "same_structure" }),
            attempt({ daysAgo: 1, variationType: "same_structure" }),
        ];
        const result = aggregateKnowledgeScore(attempts, undefined, null, NOW);
        expect(result.status).toBe("MASTERED");
        expect(result.delayedReviewPassed).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(80);
    });
    it("使用提示的作答不计入独立掌握证据", () => {
        const attempts = [
            attempt({ daysAgo: 4, usedHint: true, variationType: "same_structure" }),
            attempt({ daysAgo: 3, usedHint: true, variationType: "changed_condition" }),
            attempt({ daysAgo: 2, usedHint: true, variationType: "error_targeted" }),
        ];
        const result = aggregateKnowledgeScore(attempts, undefined, null, NOW);
        expect(result.status).not.toBe("MASTERED");
        expect(result.independentAttempts).toBe(0);
    });
    it("已经掌握后再次出错会转为需要复习", () => {
        const attempts = [attempt({ daysAgo: 2, correct: false })];
        const result = aggregateKnowledgeScore(attempts, undefined, "MASTERED", NOW);
        expect(result.status).toBe("NEEDS_REVIEW");
    });
});
describe("学习优先级排序", () => {
    const base = { severity: 2, reason: "测试", detectedAt: NOW };
    it("前置缺口优先于重复出错，重复出错优先于复测", () => {
        const ranked = rankLearningPriorities([
            { ...base, type: "REVIEW_DUE" },
            { ...base, type: "REPEATED_ERROR" },
            { ...base, type: "PREREQUISITE_GAP" },
        ], { now: NOW });
        expect(ranked.map((item) => item.type)).toEqual(["PREREQUISITE_GAP", "REPEATED_ERROR", "REVIEW_DUE"]);
    });
    it("严重度更高的同类信号排前面", () => {
        const ranked = rankLearningPriorities([
            { ...base, type: "REPEATED_ERROR", severity: 1, label: "A" },
            { ...base, type: "REPEATED_ERROR", severity: 3, label: "B" },
        ], { now: NOW });
        expect(ranked[0].label).toBe("B");
    });
    it("与当前阶段目标相关的优先级会加分", () => {
        const withoutGoal = rankLearningPriorities([{ ...base, type: "LOW_MASTERY", subject: "数学" }], { now: NOW });
        const withGoal = rankLearningPriorities([{ ...base, type: "LOW_MASTERY", subject: "数学" }], { goalText: "提升数学看图列式能力", now: NOW });
        expect(withGoal[0].priorityScore).toBeGreaterThan(withoutGoal[0].priorityScore);
        expect(withGoal[0].priorityBreakdown.goal_relevance).toBeGreaterThan(0);
    });
});
describe("学习信号识别", () => {
    beforeEach(() => {
        masteryFindMany.mockResolvedValue([
            {
                questionTypeId: "qt1",
                status: "learning",
                masteryScore: 40,
                totalAttempts: 5,
                variationCount: 1,
                correctRate: 0.4,
                nextReviewAt: new Date(NOW.getTime() - 86_400_000),
                questionType: { name: "看图列式", subject: "数学", masteryCriteria: null },
            },
        ]);
        wrongFindMany.mockResolvedValue([
            {
                id: "w1",
                questionTypeId: "qt1",
                subject: "数学",
                mistakeCount: 2,
                lastWrongAt: new Date(NOW.getTime() - 2 * 86_400_000),
                nextReviewAt: new Date(NOW.getTime() - 3_600_000),
                errorReason: "混淆总量与部分量",
                questionType: { name: "看图列式" },
            },
        ]);
        stateFindUnique.mockResolvedValue(null);
        stateUpsert.mockResolvedValue({ status: "LEARNING", score: 30 });
        typeLinkFindMany.mockResolvedValue([]);
        questionLinkFindMany.mockResolvedValue([]);
        attemptFindMany.mockResolvedValue([]);
    });
    it("从真实错题与掌握度里算出五类信号", async () => {
        stateFindMany.mockResolvedValue([
            { knowledgeNodeId: "n1", status: "LEARNING", score: 30, knowledgeNode: { title: "部分量与总量" } },
            { knowledgeNodeId: "n2", status: "PARTIAL", score: 65, knowledgeNode: { title: "看图列式综合" } },
        ]);
        relationFindMany.mockResolvedValue([
            { sourceNodeId: "n1", targetNodeId: "n2", relationType: "PREREQUISITE_OF", strength: "hard", reason: "先分清部分与总量" },
        ]);
        const signals = await detectLearningSignals("fam1", "c1", NOW);
        const types = signals.map((item) => item.type);
        expect(types).toContain("REVIEW_DUE");
        expect(types).toContain("REPEATED_ERROR");
        expect(types).toContain("LOW_MASTERY");
        expect(types).toContain("VARIATION_GAP");
        expect(types).toContain("PREREQUISITE_GAP");
        const prerequisite = signals.find((item) => item.type === "PREREQUISITE_GAP");
        expect(prerequisite?.knowledgeNodeId).toBe("n1");
        expect(prerequisite?.reason).toContain("部分量与总量");
    });
    it("前置知识一旦达标就不再提示缺口的信号", async () => {
        stateFindMany.mockResolvedValue([
            { knowledgeNodeId: "n1", status: "MASTERED", score: 90, knowledgeNode: { title: "部分量与总量" } },
            { knowledgeNodeId: "n2", status: "LEARNING", score: 40, knowledgeNode: { title: "看图列式综合" } },
        ]);
        relationFindMany.mockResolvedValue([
            { sourceNodeId: "n1", targetNodeId: "n2", relationType: "PREREQUISITE_OF", strength: "hard", reason: "先分清部分与总量" },
        ]);
        const signals = await detectLearningSignals("fam1", "c1", NOW);
        expect(signals.some((item) => item.type === "PREREQUISITE_GAP")).toBe(false);
    });
});
describe("作答回写知识点状态", () => {
    beforeEach(() => {
        questionLinkFindMany.mockResolvedValue([]);
        typeLinkFindMany.mockResolvedValue([{ knowledgeNodeId: "n1", questionTypeId: "qt1" }]);
        questionTypeFindFirst.mockResolvedValue({ id: "qt1", masteryCriteria: null });
        attemptFindMany.mockResolvedValue([attempt({ daysAgo: 1 })]);
        stateFindUnique.mockResolvedValue(null);
        stateUpsert.mockImplementation(({ create }) => Promise.resolve({ ...create }));
    });
    it("作答后按题型关联的知识节点刷新掌握状态", async () => {
        const result = await refreshKnowledgeStateFromAttempt("fam1", "c1", "q1", "qt1", NOW);
        expect(stateUpsert).toHaveBeenCalledTimes(1);
        expect(result.updated[0].knowledge_node_id).toBe("n1");
    });
    it("题目级关联优先于题型默认关联", async () => {
        questionLinkFindMany.mockResolvedValue([{ knowledgeNodeId: "n9", questionId: "q1" }]);
        const result = await refreshKnowledgeStateFromAttempt("fam1", "c1", "q1", "qt1", NOW);
        expect(result.updated[0].knowledge_node_id).toBe("n9");
    });
    it("人工修正过的状态不会被自动计算覆盖", async () => {
        stateFindUnique.mockResolvedValue({ status: "MASTERED", manualStatus: "MASTERED" });
        await refreshKnowledgeStateFromAttempt("fam1", "c1", "q1", "qt1", NOW);
        const payload = stateUpsert.mock.calls[0][0];
        expect(payload.update.status).toBe("MASTERED");
        expect(payload.update.evidence.calculated_status).toBe("LEARNING");
    });
});
describe("信号同步与待规划事项", () => {
    it("已经消失的信号会被标记为已解决", async () => {
        signalFindMany
            .mockResolvedValueOnce([{ id: "s1", dedupeKey: "stale:1", status: "active" }])
            .mockResolvedValueOnce([]);
        masteryFindMany.mockResolvedValue([]);
        wrongFindMany.mockResolvedValue([]);
        stateFindMany.mockResolvedValue([]);
        relationFindMany.mockResolvedValue([]);
        await syncLearningSignals("fam1", "c1", NOW);
        expect(signalUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "s1" },
            data: expect.objectContaining({ status: "resolved" }),
        }));
    });
    it("已有待规划事项时不会重复创建", async () => {
        requestFindFirst.mockResolvedValue({ id: "pr1", status: "pending" });
        const result = await ensurePlanningRequest("fam1", "c1", NOW);
        expect(result).toMatchObject({ id: "pr1" });
        expect(requestCreate).not.toHaveBeenCalled();
    });
    it("家长可以忽略单条信号并记录原因", async () => {
        signalFindMany.mockResolvedValue([]);
        signalFindFirst.mockResolvedValue({ id: "s1", evidence: { a: 1 } });
        signalUpdate.mockResolvedValue({ id: "s1", status: "dismissed" });
        const result = await resolveLearningSignal("fam1", "s1", { status: "dismissed", note: "已经在家校沟通中处理" }, NOW);
        expect(result.status).toBe("dismissed");
        expect(signalUpdate.mock.calls[0][0].data.evidence.resolution_note).toContain("家校沟通");
    });
});
describe("学习优先级对外输出", () => {
    it("没有任何信号时 planning_required 由是否存在有效目标决定", async () => {
        childFindFirst.mockResolvedValue({ id: "c1", name: "JOJO", grade: "三年级", subjects: ["数学"] });
        goalFindFirst.mockResolvedValue({ id: "g1", title: "提升数学", objective: "掌握看图列式", endDate: new Date(NOW.getTime() + 86_400_000) });
        masteryFindMany.mockResolvedValue([]);
        wrongFindMany.mockResolvedValue([]);
        stateFindMany.mockResolvedValue([]);
        relationFindMany.mockResolvedValue([]);
        signalFindMany.mockResolvedValue([]);
        questionTypeFindMany.mockResolvedValue([]);
        knowledgeNodeFindMany.mockResolvedValue([]);
        const result = await getLearningPriorities("fam1", "c1", { now: NOW });
        expect(result.priorities).toEqual([]);
        expect(result.planning_required).toBe(false);
    });
});
