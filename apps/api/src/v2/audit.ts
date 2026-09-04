import { prisma } from "../prisma.js";

export async function writeAudit(input: {
  familyId?: string | null;
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  metadata?: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      familyId: input.familyId || null,
      actorType: input.actorType,
      actorId: input.actorId || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      before: input.before === undefined ? undefined : (input.before as any),
      after: input.after === undefined ? undefined : (input.after as any),
      reason: input.reason || null,
      metadata: input.metadata === undefined ? undefined : (input.metadata as any),
    },
  });
}
