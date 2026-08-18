import { describe, expect, it } from "vitest";
import { calculateMastery, normalizeMasteryCriteria } from "./question-bank.js";
function attempt(hours, options = {}) {
    return {
        isCorrect: true,
        score: 100,
        usedHint: false,
        attemptedAt: new Date(Date.UTC(2026, 7, 1, hours)),
        question: { variationType: "structure", difficulty: "basic" },
        ...options,
    };
}
describe("question type mastery", () => {
    it("normalizes unsafe mastery criteria", () => {
        expect(normalizeMasteryCriteria({ minScore: 150, minAttempts: 0 })).toMatchObject({
            minScore: 100,
            minAttempts: 5,
            minVariations: 3,
        });
    });
    it("does not mark mastery after one correct answer", () => {
        const result = calculateMastery([attempt(1)], undefined);
        expect(result.calculatedStatus).toBe("learning");
        expect(result.totalAttempts).toBe(1);
        expect(result.masteryScore).toBeLessThan(80);
    });
    it("requires variations, transfer and delayed review for mastery", () => {
        const attempts = [
            attempt(0, { question: { variationType: "structure", difficulty: "basic" } }),
            attempt(2, { question: { variationType: "wording", difficulty: "basic" } }),
            attempt(4, { question: { variationType: "error_focus", difficulty: "advanced" } }),
            attempt(6, { question: { variationType: "transfer", difficulty: "transfer" } }),
            attempt(25, { question: { variationType: "review", difficulty: "review" } }),
        ];
        const result = calculateMastery(attempts, undefined, "basic", new Date(Date.UTC(2026, 7, 2, 2)));
        expect(result.calculatedStatus).toBe("mastered");
        expect(result.masteryScore).toBe(100);
        expect(result.evidence.delayedReviewPassed).toBe(true);
    });
    it("moves previously mastered content back to review when evidence degrades", () => {
        const attempts = [
            attempt(0),
            attempt(1, { question: { variationType: "wording", difficulty: "basic" } }),
            attempt(2, { question: { variationType: "transfer", difficulty: "transfer" } }),
            attempt(25, { question: { variationType: "review", difficulty: "review" } }),
            attempt(26),
            ...Array.from({ length: 5 }, (_, index) => attempt(30 + index, { isCorrect: false, score: 0 })),
        ];
        const result = calculateMastery(attempts, undefined, "mastered", new Date(Date.UTC(2026, 7, 3)));
        expect(result.calculatedStatus).toBe("needs_review");
        expect(result.masteryScore).toBeLessThan(80);
    });
});
