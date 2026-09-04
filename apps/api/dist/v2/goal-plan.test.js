import { describe, expect, it, vi, beforeEach } from "vitest";
const childFindFirst = vi.fn();
const stageGoalFindFirst = vi.fn();
const stageGoalCreate = vi.fn();
const stageGoalFindMany = vi.fn();
const stageGoalCount = vi.fn();
const stageGoalUpdate = vi.fn();
const weeklyPlanCreate = vi.fn();
const weeklyPlanFindFirst = vi.fn();
const weeklyPlanUpdate = vi.fn();
const planItemFindFirst = vi.fn();
const planItemUpdate = vi.fn();
const assessmentCreate = vi.fn();
const transaction = vi.fn();
const auditCreate = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        stageGoal: {
            create: stageGoalCreate,
            findFirst: stageGoalFindFirst,
            findMany: stageGoalFindMany,
            count: stageGoalCount,
            update: stageGoalUpdate,
        },
        weeklyPlan: {
            create: weeklyPlanCreate,
            findFirst: weeklyPlanFindFirst,
            update: weeklyPlanUpdate,
        },
        planItem: {
            findFirst: planItemFindFirst,
            update: planItemUpdate,
        },
        assessment: { create: assessmentCreate },
        auditLog: { create: auditCreate },
        $transaction: transaction,
    },
}));
const { proposeStageGoals, createWeeklyPlan, updatePlanItemStatus } = await import("./goal-plan.js");
function goalData(overrides = {}) {
    const start = new Date("2026-09-07");
    const end = new Date("2026-10-19");
    return { title: "数学退位减法", objective: "提升退位减法正确率", startDate: start, endDate: end, ...overrides };
}
describe("goal and plan", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1" });
        stageGoalCreate.mockImplementation(async ({ data }) => ({ id: "goal-1", ...data }));
        transaction.mockImplementation(async (items) => Promise.all(items));
        auditCreate.mockResolvedValue({ id: "audit-1" });
        stageGoalFindFirst.mockResolvedValue({ id: "goal-1", familyId: "family-1", childId: "child-1", status: "CONFIRMED" });
        weeklyPlanCreate.mockImplementation(async ({ data }) => ({ id: "plan-1", ...data, items: [] }));
        stageGoalUpdate.mockResolvedValue({ id: "goal-1", status: "ACTIVE" });
    });
    it("requires two or three goal drafts", async () => {
        await expect(proposeStageGoals("family-1", "child-1", [goalData()])).rejects.toThrow("候选目标必须提供 2 至 3 个");
    });
    it("rejects goals shorter than four weeks", async () => {
        await expect(proposeStageGoals("family-1", "child-1", [
            goalData({ startDate: "2026-09-07", endDate: "2026-09-10" }),
            goalData({ startDate: "2026-09-07", endDate: "2026-09-11" }),
        ])).rejects.toThrow("4 至 8 周");
    });
    it("creates proposed goals", async () => {
        const result = await proposeStageGoals("family-1", "child-1", [goalData(), goalData({ title: "另一个目标" })]);
        expect(result).toHaveLength(2);
        expect(stageGoalCreate).toHaveBeenCalledTimes(2);
        expect(stageGoalCreate.mock.calls[0][0].data.status).toBe("PROPOSED");
    });
    it("creates a weekly plan only for a confirmed or active goal", async () => {
        await createWeeklyPlan("family-1", "goal-1", "2026-09-07", [
            { type: "CHILD_TASK", title: "每日 10 题" },
        ]);
        expect(weeklyPlanCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                childId: "child-1",
                status: "DRAFT",
                items: expect.objectContaining({ create: expect.any(Array) }),
            }),
        }));
    });
    it("requires completion evidence when completing a plan item", async () => {
        planItemFindFirst.mockResolvedValue({
            id: "item-1",
            status: "PENDING",
            completedAt: null,
            weeklyPlan: { familyId: "family-1" },
        });
        await expect(updatePlanItemStatus("family-1", "item-1", { status: "COMPLETED", evidence: null })).rejects.toThrow("完成任务必须提供完成证据");
    });
});
