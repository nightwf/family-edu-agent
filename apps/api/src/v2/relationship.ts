import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

async function assertChildInFamily(familyId: string, childId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");
  return child;
}

export async function saveRelationshipSnapshot(
  familyId: string,
  input: {
    childId: string;
    status?: string;
    score?: number | null;
    communicationNote?: string | null;
    conflictCount?: number | null;
    parentAction?: string | null;
    evidence?: Record<string, unknown> | null;
  },
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
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
      evidence: (input.evidence ?? undefined) as any,
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

export async function getLatestRelationship(familyId: string, childId: string) {
  await assertChildInFamily(familyId, childId);
  return prisma.childRelationshipSnapshot.findFirst({
    where: { familyId, childId },
    orderBy: { generatedAt: "desc" },
  });
}

export async function listRelationshipHistory(
  familyId: string,
  childId: string,
  limit = 20,
  offset = 0,
) {
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
