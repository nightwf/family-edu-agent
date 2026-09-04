import { prisma } from "../prisma.js";

export async function getChildState(familyId: string, childId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const sixWeeksAgo = new Date(now.getTime() - 42 * 86_400_000);

  const [recentEvidence, phaseEvidence, activeGoal, latestAssessment] = await Promise.all([
    prisma.evidenceRecord.findMany({
      where: { familyId, childId, observedAt: { gte: sevenDaysAgo } },
      orderBy: { observedAt: "desc" },
      take: 20,
    }),
    prisma.evidenceRecord.findMany({
      where: { familyId, childId, observedAt: { gte: sixWeeksAgo } },
      orderBy: { observedAt: "desc" },
      take: 100,
    }),
    prisma.stageGoal.findFirst({
      where: {
        familyId,
        childId,
        status: { in: ["ACTIVE", "CONFIRMED"] },
      },
      orderBy: { endDate: "desc" },
    }),
    prisma.assessment.findFirst({
      where: { familyId, childId },
      orderBy: { observedAt: "desc" },
    }),
  ]);

  const summary = {
    evidence_7d: recentEvidence.length,
    evidence_42d: phaseEvidence.length,
    pending_confirmation: phaseEvidence.filter((item) => item.reviewStatus === "PENDING_CONFIRMATION").length,
    confirmed: phaseEvidence.filter((item) => item.reviewStatus === "CONFIRMED").length,
    corrected: phaseEvidence.filter((item) => item.reviewStatus === "CORRECTED").length,
    average_confidence:
      phaseEvidence.length > 0
        ? phaseEvidence.reduce((sum, item) => sum + (item.confidence || 0), 0) / phaseEvidence.length
        : null,
  };

  return {
    child: {
      id: child.id,
      name: child.name,
      grade: child.grade,
      subjects: child.subjects,
    },
    asOf: now.toISOString(),
    summary,
    active_goal: activeGoal,
    latest_assessment: latestAssessment,
    recent_evidence: recentEvidence,
  };
}
