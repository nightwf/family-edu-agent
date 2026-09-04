import { prisma } from "../prisma.js";
export async function writeAudit(input) {
    return prisma.auditLog.create({
        data: {
            familyId: input.familyId || null,
            actorType: input.actorType,
            actorId: input.actorId || null,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId || null,
            before: input.before === undefined ? undefined : input.before,
            after: input.after === undefined ? undefined : input.after,
            reason: input.reason || null,
            metadata: input.metadata === undefined ? undefined : input.metadata,
        },
    });
}
