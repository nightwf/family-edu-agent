import { describe, expect, it, vi, beforeEach } from "vitest";
const childFindFirst = vi.fn();
const evidenceCreate = vi.fn();
const evidenceFindFirst = vi.fn();
const evidenceFindMany = vi.fn();
const evidenceCount = vi.fn();
const evidenceUpdate = vi.fn();
const auditCreate = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        evidenceRecord: {
            create: evidenceCreate,
            findFirst: evidenceFindFirst,
            findMany: evidenceFindMany,
            count: evidenceCount,
            update: evidenceUpdate,
        },
        auditLog: { create: auditCreate },
    },
}));
const { createEvidenceRecord, listEvidence, reviewEvidenceRecord } = await import("./evidence.js");
describe("evidence records", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1" });
        evidenceCreate.mockImplementation(async ({ data }) => ({ id: "evidence-1", reviewStatus: "PENDING_CONFIRMATION", ...data }));
        evidenceFindFirst.mockResolvedValue({ id: "evidence-1", familyId: "family-1", reviewStatus: "PENDING_CONFIRMATION" });
        evidenceFindMany.mockResolvedValue([]);
        evidenceCount.mockResolvedValue(0);
        evidenceUpdate.mockImplementation(async ({ data }) => ({ id: "evidence-1", reviewStatus: "CONFIRMED", ...data }));
        auditCreate.mockResolvedValue({ id: "audit-1" });
    });
    it("rejects evidence for a child outside the current family", async () => {
        childFindFirst.mockResolvedValue(null);
        await expect(createEvidenceRecord("family-1", { childId: "child-other", type: "OBSERVATION" })).rejects.toThrow("学生不存在或不属于当前家庭");
    });
    it("creates a pending evidence record with structured fields", async () => {
        const record = await createEvidenceRecord("family-1", {
            childId: "child-1",
            type: "OBSERVATION",
            observedBehavior: "任务拆分后可完成",
            confidence: 0.8,
        });
        expect(record.reviewStatus).toBe("PENDING_CONFIRMATION");
        expect(record.observedBehavior).toBe("任务拆分后可完成");
        expect(auditCreate).toHaveBeenCalledOnce();
    });
    it("confirms evidence and writes an audit record", async () => {
        const updated = await reviewEvidenceRecord("family-1", "evidence-1", "confirm", { type: "parent", id: "user-1" }, "符合观察");
        expect(updated.reviewStatus).toBe("CONFIRMED");
        expect(auditCreate).toHaveBeenCalledOnce();
    });
});
