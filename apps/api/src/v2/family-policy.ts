import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

export type FamilyPolicyInput = {
  weeklyTimeBudget?: number | null;
  prioritySubjects?: string[];
  pressureBoundary?: string | null;
  parentGoals?: string[];
  principles?: Record<string, unknown> | null;
};

export async function getFamilyPolicy(familyId: string) {
  const policy = await prisma.familyPolicy.findUnique({ where: { familyId } });
  if (policy) return policy;

  return prisma.familyPolicy.create({
    data: {
      familyId,
      prioritySubjects: [],
      parentGoals: [],
    },
  });
}

export async function updateFamilyPolicy(
  familyId: string,
  input: FamilyPolicyInput,
  actor: { type: string; id?: string } = { type: "parent" },
) {
  const before = await getFamilyPolicy(familyId);
  const data: Record<string, unknown> = { version: before.version + 1 };

  if (input.weeklyTimeBudget !== undefined) data.weeklyTimeBudget = input.weeklyTimeBudget;
  if (input.prioritySubjects !== undefined) data.prioritySubjects = input.prioritySubjects;
  if (input.pressureBoundary !== undefined) data.pressureBoundary = input.pressureBoundary;
  if (input.parentGoals !== undefined) data.parentGoals = input.parentGoals;
  if (input.principles !== undefined) data.principles = input.principles;

  const after = await prisma.familyPolicy.update({
    where: { familyId },
    data,
  });

  await prisma.policyChange.create({
    data: {
      familyId,
      type: "family_policy_update",
      summary: "更新家庭边界",
      before: before as any,
      after: after as any,
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

export async function proposeFamilyPolicyChange(
  familyId: string,
  input: {
    type: string;
    summary?: string;
    reason?: string;
    before?: Record<string, unknown> | null;
    after: Record<string, unknown>;
  },
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  await getFamilyPolicy(familyId);
  return prisma.policyChange.create({
    data: {
      familyId,
      type: input.type,
      summary: input.summary,
      reason: input.reason,
      before: (input.before ?? undefined) as any,
      after: input.after as any,
      createdBy: actor.id || actor.type,
      status: "proposed",
    },
  });
}

export async function reviewFamilyPolicyChange(
  familyId: string,
  changeId: string,
  action: "approved" | "ignored",
  actor: { type: string; id?: string },
) {
  const change = await prisma.policyChange.findFirst({ where: { id: changeId, familyId } });
  if (!change) throw new Error("家庭边界建议不存在或不属于当前家庭");

  const updated = await prisma.policyChange.update({
    where: { id: changeId },
    data: {
      status: action,
      reviewedAt: new Date(),
      effective: action === "approved",
    },
  });

  if (action === "approved" && change.after) {
    const after = change.after as Record<string, unknown>;
    const before = await getFamilyPolicy(familyId);
    await prisma.familyPolicy.update({
      where: { familyId },
      data: {
        version: before.version + 1,
        weeklyTimeBudget: after.weeklyTimeBudget as number | undefined,
        prioritySubjects: after.prioritySubjects as string[] | undefined,
        pressureBoundary: after.pressureBoundary as string | undefined,
        parentGoals: after.parentGoals as string[] | undefined,
        principles: after.principles as any,
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
