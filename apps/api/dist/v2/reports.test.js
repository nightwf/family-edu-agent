import { describe, expect, it, vi, beforeEach } from "vitest";
const childFindFirst = vi.fn();
const evidenceFindMany = vi.fn();
const planItemFindMany = vi.fn();
const assessmentFindMany = vi.fn();
const weeklyReviewUpsert = vi.fn();
const weeklyReviewFindUnique = vi.fn();
const weeklyReviewUpdate = vi.fn();
const stageGoalFindFirst = vi.fn();
const methodEffectFindMany = vi.fn();
const stageReportCreate = vi.fn();
const auditCreate = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        evidenceRecord: { findMany: evidenceFindMany },
        planItem: { findMany: planItemFindMany },
        assessment: { findMany: assessmentFindMany },
        weeklyReview: {
            upsert: weeklyReviewUpsert,
            findUnique: weeklyReviewFindUnique,
            update: weeklyReviewUpdate,
        },
        stageGoal: { findFirst: stageGoalFindFirst },
        methodEffect: { findMany: methodEffectFindMany },
        stageReport: { create: stageReportCreate },
        auditLog: { create: auditCreate },
    },
}));
const { createWeeklyReviewDraft, createStageReport } = await import("./reports.js");
describe("reports v2", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1" });
        evidenceFindMany.mockResolvedValue([
            { id: "e1", reviewStatus: "CONFIRMED" },
            { id: "e2", reviewStatus: "PENDING_CONFIRMATION" },
        ]);
        planItemFindMany.mockResolvedValue([
            { id: "p1", status: "COMPLETED", weeklyPlan: {} },
            { id: "p2", status: "PENDING", weeklyPlan: {} },
        ]);
        assessmentFindMany.mockResolvedValue([]);
        weeklyReviewUpsert.mockImplementation(async ({ create, update }) => ({ id: "review-1", ...(create || update) }));
        stageGoalFindFirst.mockResolvedValue({
            id: "goal-1",
            familyId: "family-1",
            childId: "child-1",
            title: "退位减法",
            objective: "提高正确率",
            startDate: new Date("2026-09-01"),
            endDate: new Date("2026-10-01"),
        });
        methodEffectFindMany.mockResolvedValue([]);
        stageReportCreate.mockImplementation(async ({ data }) => ({ id: "report-1", ...data }));
        auditCreate.mockResolvedValue({ id: "audit-1" });
    });
    it("creates a weekly review draft from structured evidence and plan items", async () => {
        const result = await createWeeklyReviewDraft("family-1", "child-1", "2026-09-07");
        expect(result.draft.evidence_count).toBe(2);
        expect(result.draft.pending_evidence_count).toBe(1);
        expect(result.draft.completed_item_count).toBe(1);
        expect(result.draft.pending_item_count).toBe(1);
    });
    it("creates a stage report with an evidence-backed verdict", async () => {
        assessmentFindMany.mockResolvedValue([
            { id: "a1", passed: true },
            { id: "a2", passed: true },
        ]);
        const report = await createStageReport("family-1", "child-1", "goal-1");
        expect(report.verdict).toBe("improved");
        expect(report.summary).toContain("通过 2 次");
    });
});
