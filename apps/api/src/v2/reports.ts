import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

async function assertChildInFamily(familyId: string, childId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");
  return child;
}

function weekRange(weekStart: Date) {
  const start = new Date(weekStart);
  if (Number.isNaN(start.getTime())) throw new Error("周开始日期无效");
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end };
}

export async function createWeeklyReviewDraft(
  familyId: string,
  childId: string,
  weekStart: Date | string,
) {
  await assertChildInFamily(familyId, childId);
  const { start, end } = weekRange(new Date(weekStart));

  const [evidence, planItems, assessments] = await Promise.all([
    prisma.evidenceRecord.findMany({
      where: { familyId, childId, observedAt: { gte: start, lt: end } },
      orderBy: { observedAt: "asc" },
    }),
    prisma.planItem.findMany({
      where: {
        weeklyPlan: {
          familyId,
          childId,
          weekStart: { gte: start, lt: end },
        },
      },
      include: { weeklyPlan: true },
      orderBy: [{ weeklyPlan: { weekStart: "asc" } }, { sequence: "asc" }],
    }),
    prisma.assessment.findMany({
      where: { familyId, childId, observedAt: { gte: start, lt: end } },
      orderBy: { observedAt: "asc" },
    }),
  ]);

  const completedItems = planItems.filter((item) => item.status === "COMPLETED");
  const pendingItems = planItems.filter((item) => item.status !== "COMPLETED" && item.status !== "CANCELLED");
  const confirmedEvidence = evidence.filter((item) => item.reviewStatus === "CONFIRMED");
  const pendingEvidence = evidence.filter((item) => item.reviewStatus === "PENDING_CONFIRMATION");

  const draft = {
    week_start: start.toISOString(),
    week_end: end.toISOString(),
    evidence_count: evidence.length,
    confirmed_evidence_count: confirmedEvidence.length,
    pending_evidence_count: pendingEvidence.length,
    plan_item_count: planItems.length,
    completed_item_count: completedItems.length,
    pending_item_count: pendingItems.length,
    assessment_count: assessments.length,
    generated_at: new Date().toISOString(),
  };

  const review = await prisma.weeklyReview.upsert({
    where: { childId_weekStart: { childId, weekStart: start } },
    update: {
      weekEnd: end,
      draft: draft as any,
      status: "draft",
    },
    create: {
      familyId,
      childId,
      weekStart: start,
      weekEnd: end,
      status: "draft",
      draft: draft as any,
    },
  });

  await writeAudit({
    familyId,
    actorType: "system",
    action: "weekly_review.draft",
    entityType: "WeeklyReview",
    entityId: review.id,
    after: draft,
  });

  return { review, draft };
}

export async function confirmWeeklyReview(
  familyId: string,
  childId: string,
  weekStart: Date | string,
  adjustments?: Record<string, unknown> | null,
  actor: { type: string; id?: string } = { type: "parent" },
) {
  await assertChildInFamily(familyId, childId);
  const { start } = weekRange(new Date(weekStart));

  const review = await prisma.weeklyReview.findUnique({
    where: { childId_weekStart: { childId, weekStart: start } },
  });
  if (!review || review.familyId !== familyId) {
    throw new Error("周回顾不存在或不属于当前家庭");
  }

  const updated = await prisma.weeklyReview.update({
    where: { id: review.id },
    data: {
      status: "confirmed",
      parentAdjustments: (adjustments ?? undefined) as any,
      confirmedAt: new Date(),
    },
  });

  await writeAudit({
    familyId,
    actorType: actor.type,
    actorId: actor.id,
    action: "weekly_review.confirm",
    entityType: "WeeklyReview",
    entityId: review.id,
    before: review,
    after: updated,
  });

  return updated;
}

export async function createStageReport(
  familyId: string,
  childId: string,
  stageGoalId: string,
) {
  const [child, goal] = await Promise.all([
    assertChildInFamily(familyId, childId),
    prisma.stageGoal.findFirst({ where: { id: stageGoalId, familyId, childId } }),
  ]);
  if (!goal) throw new Error("阶段目标不存在或不属于当前家庭");

  const [assessments, methodEffects, evidence] = await Promise.all([
    prisma.assessment.findMany({
      where: { familyId, childId, stageGoalId },
      orderBy: { observedAt: "asc" },
    }),
    prisma.methodEffect.findMany({
      where: { familyId, childId, goalId: stageGoalId },
      orderBy: { observedAt: "asc" },
    }),
    prisma.evidenceRecord.findMany({
      where: {
        familyId,
        childId,
        observedAt: { gte: goal.startDate, lte: goal.endDate },
      },
      orderBy: { observedAt: "asc" },
    }),
  ]);

  const passedAssessments = assessments.filter((item) => item.passed === true);
  const failedAssessments = assessments.filter((item) => item.passed === false);
  const verdict =
    passedAssessments.length > 0 && failedAssessments.length === 0
      ? "improved"
      : assessments.length > 0
        ? "mixed"
        : "insufficient_evidence";

  const summary = [
    `阶段目标：${goal.title}`,
    `目标说明：${goal.objective}`,
    `复测 ${assessments.length} 次，通过 ${passedAssessments.length} 次，未通过 ${failedAssessments.length} 次。`,
    `记录方法效果 ${methodEffects.length} 条，结构化证据 ${evidence.length} 条。`,
  ].join("\n");

  const report = await prisma.stageReport.create({
    data: {
      familyId,
      childId,
      stageGoalId,
      periodStart: goal.startDate,
      periodEnd: goal.endDate,
      verdict,
      summary,
      evidence: {
        assessments,
        method_effects: methodEffects,
        evidence_records: evidence,
      } as any,
      nextRecommendations: {
        if_improved: "进入下一阶段目标，或延长复测间隔。",
        if_mixed: "保留有效策略，针对未通过项做一次短周期干预。",
        if_insufficient_evidence: "先补充复测证据，不急于形成结论。",
      },
      status: "draft",
    },
  });

  await writeAudit({
    familyId,
    actorType: "system",
    action: "stage_report.create",
    entityType: "StageReport",
    entityId: report.id,
    after: report,
  });

  return report;
}
