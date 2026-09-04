import { describe, expect, it, vi, beforeEach } from "vitest";
const childFindFirst = vi.fn();
const evidenceFindMany = vi.fn();
const goalFindFirst = vi.fn();
const assessmentFindFirst = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        child: { findFirst: childFindFirst },
        evidenceRecord: { findMany: evidenceFindMany },
        stageGoal: { findFirst: goalFindFirst },
        assessment: { findFirst: assessmentFindFirst },
    },
}));
const { getChildState } = await import("./child-state.js");
describe("child state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1", name: "JOJO", grade: "三年级", subjects: ["数学"] });
        evidenceFindMany.mockImplementation(async ({ where }) => {
            if (where.observedAt.gte.getTime() > Date.now() - 8 * 86_400_000) {
                return [{ id: "e-1", confidence: 0.8, reviewStatus: "CONFIRMED" }];
            }
            return [
                { id: "e-1", confidence: 0.8, reviewStatus: "CONFIRMED" },
                { id: "e-2", confidence: 0.6, reviewStatus: "PENDING_CONFIRMATION" },
            ];
        });
        goalFindFirst.mockResolvedValue(null);
        assessmentFindFirst.mockResolvedValue(null);
    });
    it("returns structured child state instead of raw history", async () => {
        const state = await getChildState("family-1", "child-1");
        expect(state.child.name).toBe("JOJO");
        expect(state.summary.pending_confirmation).toBe(1);
        expect(state.summary.confirmed).toBe(1);
        expect(state.recent_evidence).toHaveLength(1);
    });
});
