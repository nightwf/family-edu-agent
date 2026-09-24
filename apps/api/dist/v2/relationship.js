import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
import { assertChildInFamily } from "./guards.js";
export async function saveRelationshipSnapshot(familyId, input, actor = { type: "workbuddy" }) {
    await assertChildInFamily(familyId, input.childId);
    const snapshot = await prisma.childRelationshipSnapshot.create({
        data: {
            familyId,
            childId: input.childId,
            status: input.status || "stable",
            score: input.score,
            communicationNote: input.communicationNote,
            conflictCount: input.conflictCount || 0,
            parentAction: input.parentAction,
            evidence: (input.evidence ?? undefined),
        },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "relationship_snapshot.create",
        entityType: "ChildRelationshipSnapshot",
        entityId: snapshot.id,
        after: snapshot,
    });
    return snapshot;
}
export async function getLatestRelationship(familyId, childId) {
    await assertChildInFamily(familyId, childId);
    return prisma.childRelationshipSnapshot.findFirst({
        where: { familyId, childId },
        orderBy: { generatedAt: "desc" },
    });
}
export async function listRelationshipHistory(familyId, childId, limit = 20, offset = 0) {
    await assertChildInFamily(familyId, childId);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const [items, total] = await Promise.all([
        prisma.childRelationshipSnapshot.findMany({
            where: { familyId, childId },
            orderBy: { generatedAt: "desc" },
            skip: safeOffset,
            take: safeLimit,
        }),
        prisma.childRelationshipSnapshot.count({ where: { familyId, childId } }),
    ]);
    return { items, total, limit: safeLimit, offset: safeOffset };
}
