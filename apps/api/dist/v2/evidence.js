import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
import { EVIDENCE_REVIEW_ACTIONS, EVIDENCE_TYPES, requireEnumValue } from "./enum-normalize.js";
async function assertChildInFamily(familyId, childId) {
    const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
    if (!child)
        throw new Error("学生不存在或不属于当前家庭");
    return child;
}
export async function createEvidenceRecord(familyId, input, actor = { type: "workbuddy" }) {
    await assertChildInFamily(familyId, input.childId);
    const evidenceType = requireEnumValue(EVIDENCE_TYPES, input.type, "证据类型（type）");
    const record = await prisma.evidenceRecord.create({
        data: {
            familyId,
            childId: input.childId,
            type: evidenceType,
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
export async function listEvidence(familyId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const [items, total] = await Promise.all([
        prisma.evidenceRecord.findMany({
            where: {
                familyId,
                ...(filters.childId ? { childId: filters.childId } : {}),
                ...(filters.type ? { type: filters.type } : {}),
                ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
            },
            orderBy: { observedAt: "desc" },
            skip: offset,
            take: limit,
        }),
        prisma.evidenceRecord.count({
            where: {
                familyId,
                ...(filters.childId ? { childId: filters.childId } : {}),
                ...(filters.type ? { type: filters.type } : {}),
                ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
            },
        }),
    ]);
    return { items, total, limit, offset };
}
export async function reviewEvidenceRecord(familyId, evidenceId, action, actor, note) {
    const record = await prisma.evidenceRecord.findFirst({
        where: { id: evidenceId, familyId },
    });
    if (!record)
        throw new Error("证据不存在或不属于当前家庭");
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
