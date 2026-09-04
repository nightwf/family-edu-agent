import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
export async function getFamilyPolicy(familyId) {
    const policy = await prisma.familyPolicy.findUnique({ where: { familyId } });
    if (policy)
        return policy;
    return prisma.familyPolicy.create({
        data: {
            familyId,
            prioritySubjects: [],
            parentGoals: [],
        },
    });
}
export async function updateFamilyPolicy(familyId, input, actor = { type: "parent" }) {
    const before = await getFamilyPolicy(familyId);
    const data = { version: before.version + 1 };
    if (input.weeklyTimeBudget !== undefined)
        data.weeklyTimeBudget = input.weeklyTimeBudget;
    if (input.prioritySubjects !== undefined)
        data.prioritySubjects = input.prioritySubjects;
    if (input.pressureBoundary !== undefined)
        data.pressureBoundary = input.pressureBoundary;
    if (input.parentGoals !== undefined)
        data.parentGoals = input.parentGoals;
    if (input.principles !== undefined)
        data.principles = input.principles;
    const after = await prisma.familyPolicy.update({
        where: { familyId },
        data,
    });
    await prisma.policyChange.create({
        data: {
            familyId,
            type: "family_policy_update",
            summary: "更新家庭边界",
            before: before,
            after: after,
            reason: actor.type,
            createdBy: actor.id || actor.type,
            status: "approved",
            effective: true,
            reviewedAt: new Date(),
        },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "family_policy.update",
        entityType: "FamilyPolicy",
        entityId: after.id,
        before,
        after,
    });
    return after;
}
export async function proposeFamilyPolicyChange(familyId, input, actor = { type: "workbuddy" }) {
    await getFamilyPolicy(familyId);
    return prisma.policyChange.create({
        data: {
            familyId,
            type: input.type,
            summary: input.summary,
            reason: input.reason,
            before: (input.before ?? undefined),
            after: input.after,
            createdBy: actor.id || actor.type,
            status: "proposed",
        },
    });
}
export async function reviewFamilyPolicyChange(familyId, changeId, action, actor) {
    const change = await prisma.policyChange.findFirst({ where: { id: changeId, familyId } });
    if (!change)
        throw new Error("家庭边界建议不存在或不属于当前家庭");
    const updated = await prisma.policyChange.update({
        where: { id: changeId },
        data: {
            status: action,
            reviewedAt: new Date(),
            effective: action === "approved",
        },
    });
    if (action === "approved" && change.after) {
        const after = change.after;
        const before = await getFamilyPolicy(familyId);
        await prisma.familyPolicy.update({
            where: { familyId },
            data: {
                version: before.version + 1,
                weeklyTimeBudget: after.weeklyTimeBudget,
                prioritySubjects: after.prioritySubjects,
                pressureBoundary: after.pressureBoundary,
                parentGoals: after.parentGoals,
                principles: after.principles,
            },
        });
    }
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: `family_policy.${action}`,
        entityType: "PolicyChange",
        entityId: changeId,
        before: change,
        after: updated,
    });
    return updated;
}
