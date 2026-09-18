import { describe, expect, it } from "vitest";
import { buildGrowthTimeline } from "./mobile-growth.js";

describe("mobile growth timeline", () => {
  it("keeps unscored learning records visible instead of producing an empty trajectory", () => {
    const result = buildGrowthTimeline({
      records: [{ id: "r1", type: "reading", title: "阅读复述", content: "能说出故事主线", score: null, date: new Date("2026-09-01") }],
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "record:r1",
      title: "阅读复述",
      status_label: "已记录",
      score: null,
    });
    expect(result.summary.evidence_count).toBe(1);
  });

  it("combines attempts, wrong questions, mastery and reports in reverse chronological order", () => {
    const result = buildGrowthTimeline({
      attempts: [{
        id: "a1",
        attemptedAt: new Date("2026-09-03"),
        isCorrect: true,
        score: 90,
        questionType: { subject: "数学", name: "两位数加法" },
      }],
      wrongQuestions: [{
        id: "w1",
        firstWrongAt: new Date("2026-09-01"),
        masteredAt: new Date("2026-09-04"),
        status: "mastered",
        subject: "数学",
        masteryScore: 86,
        questionType: { name: "两位数加法" },
      }],
      masteries: [{
        id: "m1",
        updatedAt: new Date("2026-09-02"),
        status: "mastered",
        masteryScore: 82,
        totalAttempts: 5,
        correctRate: 0.8,
        variationCount: 3,
        questionType: { subject: "数学", name: "两位数加法" },
      }],
      reports: [{ id: "p1", createdAt: new Date("2026-08-31"), type: "weekly", title: "本周学习报告" }],
    });

    expect(result.events.map((item) => item.id)).toEqual([
      "wrong-mastered:w1",
      "attempt:a1",
      "mastery:m1",
      "wrong:w1",
      "report:p1",
    ]);
    expect(result.summary).toMatchObject({ open_wrong: 0, mastered_wrong: 1, mastered_types: 1, tracked_types: 1 });
  });

  it("does not show migrated legacy evidence twice", () => {
    const result = buildGrowthTimeline({
      records: [{ id: "r1", date: new Date("2026-09-01"), title: "数学练习" }],
      evidenceRecords: [
        { id: "e1", observedAt: new Date("2026-09-01"), taskDescription: "数学练习", sourceRef: "legacy-record:r1" },
        { id: "e2", observedAt: new Date("2026-09-02"), taskDescription: "课堂观察", sourceRef: "workbuddy:observation-1" },
      ],
    });

    expect(result.events.map((item) => item.id)).toEqual(["evidence:e2", "record:r1"]);
    expect(result.summary.evidence_count).toBe(2);
  });
});
