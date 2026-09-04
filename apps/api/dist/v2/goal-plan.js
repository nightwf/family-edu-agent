import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";
const MIN_GOAL_DAYS = 28;
const MAX_GOAL_DAYS = 63;
async function assertChildInFamily(familyId, childId) {
    const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
    if (!child)
        throw new Error("学生不存在或不属于当前家庭");
    return child;
}
function dateRangeDays(start, end) {
    return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
export async function proposeStageGoals(familyId, childId, goals, actor = { type: "workbuddy" }) {
    await assertChildInFamily(familyId, childId);
    if (goals.length < 2 || goals.length > 3) {
        throw new Error("候选目标必须提供 2 至 3 个");
    }
    const normalized = goals.map((goal) => {
        const startDate = new Date(goal.startDate);
        const endDate = new Date(goal.endDate);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            throw new Error("目标日期无效");
        }
        if (endDate <= startDate)
            throw new Error("目标结束日期必须晚于开始日期");
        const days = dateRangeDays(startDate, endDate);
        if (days < MIN_GOAL_DAYS || days > MAX_GOAL_DAYS) {
            throw new Error(`阶段目标应为 4 至 8 周，当前为 ${days} 天`);
        }
        return {
            familyId,
            childId,
            title: goal.title,
            objective: goal.objective,
            criteria: (goal.criteria ?? undefined),
            startDate,
            endDate,
            methodIds: goal.methodIds || [],
            status: "PROPOSED",
            proposedBy: actor.id || actor.type,
        };
    });
    const created = await prisma.$transaction(normalized.map((data) => prisma.stageGoal.create({ data })));
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "stage_goal.propose",
        entityType: "StageGoal",
        entityId: created.map((item) => item.id).join(","),
        after: created,
    });
    return created;
}
export async function listStageGoals(familyId, filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
    const offset = Math.max(Number(filters.offset || 0), 0);
    const where = {
        familyId,
        ...(filters.childId ? { childId: filters.childId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.stageGoal.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
        }),
        prisma.stageGoal.count({ where }),
    ]);
    return { items, total, limit, offset };
}
export async function getStageGoal(familyId, goalId) {
    const goal = await prisma.stageGoal.findFirst({ where: { id: goalId, familyId } });
    if (!goal)
        throw new Error("阶段目标不存在或不属于当前家庭");
    return goal;
}
export async function confirmStageGoal(familyId, goalId, action, actor, changes) {
    const goal = await getStageGoal(familyId, goalId);
    if (goal.status !== "PROPOSED") {
        throw new Error("只有待确认的候选目标可以执行该操作");
    }
    const nextStatus = action === "confirm" ? "CONFIRMED" : action === "cancel" || action === "reject" ? "CANCELLED" : goal.status;
    const data = {
        status: nextStatus,
        confirmedBy: action === "confirm" ? actor.id || actor.type : goal.confirmedBy,
        confirmedAt: action === "confirm" ? new Date() : goal.confirmedAt,
    };
    if (changes?.title !== undefined)
        data.title = changes.title;
    if (changes?.objective !== undefined)
        data.objective = changes.objective;
    if (changes?.criteria !== undefined)
        data.criteria = changes.criteria;
    if (changes?.startDate !== undefined)
        data.startDate = new Date(changes.startDate);
    if (changes?.endDate !== undefined)
        data.endDate = new Date(changes.endDate);
    if (changes?.methodIds !== undefined)
        data.methodIds = changes.methodIds;
    const updated = await prisma.stageGoal.update({
        where: { id: goalId },
        data,
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: `stage_goal.${action}`,
        entityType: "StageGoal",
        entityId: goalId,
        before: goal,
        after: updated,
    });
    return updated;
}
export async function createWeeklyPlan(familyId, stageGoalId, weekStart, items, actor = { type: "workbuddy" }) {
    const goal = await prisma.stageGoal.findFirst({
        where: { id: stageGoalId, familyId },
    });
    if (!goal)
        throw new Error("阶段目标不存在或不属于当前家庭");
    if (!["CONFIRMED", "ACTIVE"].includes(goal.status)) {
        throw new Error("只有已确认或执行中的目标可以生成周计划");
    }
    if (items.length === 0)
        throw new Error("周计划不能为空");
    const start = new Date(weekStart);
    if (Number.isNaN(start.getTime()))
        throw new Error("周开始日期无效");
    const end = new Date(start.getTime() + 7 * 86_400_000);
    const plan = await prisma.weeklyPlan.create({
        data: {
            familyId,
            childId: goal.childId,
            stageGoalId: goal.id,
            weekStart: start,
            weekEnd: end,
            status: "DRAFT",
            generatedBy: actor.id || actor.type,
            contextVersion: goal.contextVersion,
            items: {
                create: items.map((item, index) => ({
                    type: item.type,
                    title: item.title,
                    description: item.description,
                    ownerUserId: item.ownerUserId,
                    methodId: item.methodId,
                    sourceRef: item.sourceRef,
                    sequence: index + 1,
                    estimatedMinutes: item.estimatedMinutes,
                    dueAt: item.dueAt ? new Date(item.dueAt) : null,
                    status: "PENDING",
                    createdBy: actor.id || actor.type,
                })),
            },
        },
        include: { items: true },
    });
    await prisma.stageGoal.update({
        where: { id: goal.id },
        data: { status: "ACTIVE" },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "weekly_plan.create",
        entityType: "WeeklyPlan",
        entityId: plan.id,
        after: plan,
    });
    return plan;
}
export async function getWeeklyPlan(familyId, planId) {
    const plan = await prisma.weeklyPlan.findFirst({
        where: { id: planId, familyId },
        include: { items: { orderBy: { sequence: "asc" } } },
    });
    if (!plan)
        throw new Error("周计划不存在或不属于当前家庭");
    return plan;
}
export async function confirmWeeklyPlan(familyId, planId, actor) {
    const plan = await getWeeklyPlan(familyId, planId);
    const updated = await prisma.weeklyPlan.update({
        where: { id: planId },
        data: {
            status: "ACTIVE",
            confirmedBy: actor.id || actor.type,
            confirmedAt: new Date(),
        },
        include: { items: { orderBy: { sequence: "asc" } } },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "weekly_plan.confirm",
        entityType: "WeeklyPlan",
        entityId: planId,
        before: plan,
        after: updated,
    });
    return updated;
}
export async function updatePlanItemStatus(familyId, planItemId, input, actor = { type: "workbuddy" }) {
    const item = await prisma.planItem.findFirst({
        where: { id: planItemId },
        include: { weeklyPlan: true },
    });
    if (!item || item.weeklyPlan.familyId !== familyId) {
        throw new Error("计划任务不存在或不属于当前家庭");
    }
    if (input.status === "COMPLETED" && (!input.evidence || Object.keys(input.evidence).length === 0)) {
        throw new Error("完成任务必须提供完成证据");
    }
    const updated = await prisma.planItem.update({
        where: { id: planItemId },
        data: {
            status: input.status,
            completionEvidence: (input.evidence ?? undefined),
            completedAt: input.status === "COMPLETED" ? new Date() : item.completedAt,
        },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "plan_item.update_status",
        entityType: "PlanItem",
        entityId: planItemId,
        before: item,
        after: updated,
    });
    return updated;
}
export async function createAssessment(familyId, input, actor = { type: "workbuddy" }) {
    await assertChildInFamily(familyId, input.childId);
    if (input.stageGoalId) {
        await getStageGoal(familyId, input.stageGoalId);
    }
    const assessment = await prisma.assessment.create({
        data: {
            familyId,
            childId: input.childId,
            stageGoalId: input.stageGoalId,
            planItemId: input.planItemId,
            title: input.title,
            assessmentType: input.assessmentType,
            criteria: (input.criteria ?? undefined),
            score: input.score,
            passed: input.passed,
            outcome: (input.outcome ?? undefined),
            sourceRef: input.sourceRef,
            observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
        },
    });
    await writeAudit({
        familyId,
        actorType: actor.type,
        actorId: actor.id,
        action: "assessment.create",
        entityType: "Assessment",
        entityId: assessment.id,
        after: assessment,
    });
    return assessment;
}
