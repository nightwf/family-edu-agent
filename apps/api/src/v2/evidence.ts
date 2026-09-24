import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
import { EVIDENCE_REVIEW_ACTIONS, EVIDENCE_TYPES, requireEnumValue } from "./enum-normalize.js";
import { assertChildInFamily } from "./guards.js";

export type EvidenceInput = {
  childId: string;
  type: string;
  taskDescription?: string | null;
  environment?: string | null;
  observedBehavior?: string | null;
  frequency?: string | null;
  effectiveStrategy?: string | null;
  counterEvidence?: string | null;
  confidence?: number | null;
  source?: string;
  sourceRef?: string | null;
  observedAt?: Date | string;
};

export async function createEvidenceRecord(
  familyId: string,
  input: EvidenceInput,
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  await assertChildInFamily(familyId, input.childId);

  const evidenceType = requireEnumValue(EVIDENCE_TYPES, input.type, "证据类型（type）");
  const record = await prisma.evidenceRecord.create({
    data: {
      familyId,
      childId: input.childId,
      type: evidenceType as any,
      taskDescription: input.taskDescription,
      environment: input.environment,
      observedBehavior: input.observedBehavior,
      frequency: input.frequency,
      effectiveStrategy: input.effectiveStrategy,
      counterEvidence: input.counterEvidence,
      confidence: input.confidence,
      source: input.source || actor.type,
      sourceRef: input.sourceRef,
      observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
    },
  });

  await writeAudit({
    familyId,
    actorType: actor.type,
    actorId: actor.id,
    action: "evidence.create",
    entityType: "EvidenceRecord",
    entityId: record.id,
    after: record,
  });

  return record;
}

export async function listEvidence(
  familyId: string,
  filters: {
    childId?: string;
    type?: string;
    reviewStatus?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
  const offset = Math.max(Number(filters.offset || 0), 0);

  const [items, total] = await Promise.all([
    prisma.evidenceRecord.findMany({
      where: {
        familyId,
        ...(filters.childId ? { childId: filters.childId } : {}),
        ...(filters.type ? { type: filters.type as any } : {}),
        ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus as any } : {}),
      },
      orderBy: { observedAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.evidenceRecord.count({
      where: {
        familyId,
        ...(filters.childId ? { childId: filters.childId } : {}),
        ...(filters.type ? { type: filters.type as any } : {}),
        ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus as any } : {}),
      },
    }),
  ]);

  return { items, total, limit, offset };
}

export async function reviewEvidenceRecord(
  familyId: string,
  evidenceId: string,
  action: "confirm" | "correct",
  actor: { type: string; id?: string },
  note?: string,
) {
  const record = await prisma.evidenceRecord.findFirst({
    where: { id: evidenceId, familyId },
  });
  if (!record) throw new Error("证据不存在或不属于当前家庭");

  const resolvedAction = requireEnumValue(EVIDENCE_REVIEW_ACTIONS, action, "证据审核动作（action）");
  const updated = await prisma.evidenceRecord.update({
    where: { id: evidenceId },
    data: {
      reviewStatus: resolvedAction === "confirm" ? "CONFIRMED" : "CORRECTED",
      reviewedAt: new Date(),
      reviewedBy: actor.id || actor.type,
      reviewNote: note,
    },
  });

  await writeAudit({
    familyId,
    actorType: actor.type,
    actorId: actor.id,
      action: `evidence.${resolvedAction}`,
    entityType: "EvidenceRecord",
    entityId: evidenceId,
    before: record,
    after: updated,
    reason: note,
  });

  return updated;
}
