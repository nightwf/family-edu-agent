import { describe, expect, it } from "vitest";
import { calculateWrongQuestionMastery, normalizeWrongMasteryCriteria } from "./wrong-book.js";
function attempt(id, hours, options = {}) {
    return {
        id,
        questionId: `question-${id}`,
        isCorrect: true,
        score: 100,
        usedHint: false,
        isIndependent: true,
        isOriginalCorrection: false,
        variationType: "same_structure",
        sessionId: hours < 24 ? "session-1" : "session-2",
        attemptedAt: new Date(Date.UTC(2026, 7, 1, hours)),
        question: { difficulty: "basic", variationType: "same_structure" },
        ...options,
    };
}
describe("wrong question mastery", () => {
    it("normalizes unsafe criteria", () => {
        expect(normalizeWrongMasteryCriteria({ minScore: 200, minIndependentCorrect: 0 })).toMatchObject({
            minScore: 100,
            minIndependentCorrect: 3,
            minSessions: 2,
            delayedHours: 24,
        });
    });
    it("does not mark mastery after a single correction", () => {
        const result = calculateWrongQuestionMastery([
            attempt("correction", 1, { questionId: "original", isOriginalCorrection: true }),
        ], "original", undefined);
        expect(result.calculatedStatus).toBe("strengthening");
        expect(result.masteryScore).toBeLessThan(80);
        expect(result.evidence.independentCorrectVariants).toBe(0);
    });
    it("requires original correction, three variants, two sessions, transfer and delayed review", () => {
        const attempts = [
            attempt("correction", 0, { questionId: "original", isOriginalCorrection: true }),
            attempt("variant-1", 1),
            attempt("variant-2", 2, { variationType: "changed_condition" }),
            attempt("variant-3", 3, { variationType: "transfer", question: { difficulty: "transfer", variationType: "transfer" } }),
            attempt("review", 25, { variationType: "delayed_review", question: { difficulty: "review", variationType: "delayed_review" } }),
        ];
        const result = calculateWrongQuestionMastery(attempts, "original", undefined, "strengthening", new Date(Date.UTC(2026, 7, 2, 3)));
        expect(result.calculatedStatus).toBe("mastered");
        expect(result.masteryScore).toBe(100);
        expect(result.evidence.requirementsPassed).toBe(true);
    });
    it("returns a mastered wrong question to review after a later wrong answer", () => {
        const attempts = [
            attempt("correction", 0, { questionId: "original", isOriginalCorrection: true }),
            attempt("variant-1", 1),
            attempt("variant-2", 2, { variationType: "changed_condition" }),
            attempt("variant-3", 3, { variationType: "transfer", question: { difficulty: "transfer", variationType: "transfer" } }),
            attempt("review", 25, { variationType: "delayed_review" }),
            attempt("wrong-again", 26, { isCorrect: false, score: 0 }),
        ];
        const result = calculateWrongQuestionMastery(attempts, "original", undefined, "mastered", new Date(Date.UTC(2026, 7, 2, 4)));
        expect(result.calculatedStatus).toBe("needs_review");
    });
});
