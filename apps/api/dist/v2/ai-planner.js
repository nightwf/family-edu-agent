import { z } from "zod";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { getChatProvider, hasChatCredentials, pickModel } from "../tutor/llm/index.js";
import { confirmStageGoal, confirmWeeklyPlan, createWeeklyPlan, proposeStageGoals } from "./goal-plan.js";
import { getPlanningContext } from "./planning-context.js";
import { getPlanningRequest } from "./learning-engine.js";
const itemTypes = ["SCHOOL_HOMEWORK", "CHILD_TASK", "PARENT_ACTION", "AGENT_TASK", "RETEST"];
const plannerOutputSchema = z.object({
    summary: z.string().min(1).max(300),
    rationale: z.string().min(1).max(500),
    goals: z.array(z.object({
        title: z.string().min(1).max(80),
        objective: z.string().min(1).max(500),
        criteria: z.record(z.unknown()).default({}),
    })).min(2).max(3),
    recommended_goal_index: z.number().int().min(0).max(2),
    week_items: z.array(z.object({
        type: z.enum(itemTypes),
        title: z.string().min(1).max(100),
        description: z.string().max(500).optional().default(""),
        estimated_minutes: z.number().int().min(5).max(90),
        due_day: z.number().int().min(1).max(7),
    })).min(3).max(7),
});
function jsonPayload(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1])
        return fenced[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}
export function parseAiPlanOutput(text) {
    let value;
    try {
        value = JSON.parse(jsonPayload(text));
    }
    catch {
        throw new Error("AI 返回的计划格式无法解析，请重新生成");
    }
    const parsed = plannerOutputSchema.safeParse(value);
    if (!parsed.success || parsed.data.recommended_goal_index >= parsed.data.goals.length) {
        throw new Error("AI 返回的计划字段不完整，请重新生成");
    }
    return parsed.data;
}
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function startOfWeek(date) {
    const value = new Date(date);
    const day = value.getDay() || 7;
    value.setDate(value.getDate() - day + 1);
    value.setHours(0, 0, 0, 0);
    return value;
}
async function collectPlan(provider, context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.PLANNER_REQUEST_TIMEOUT_MS);
    let content = "";
    try {
        const stream = provider.streamChat({
            model: pickModel(false) || (provider.name === "fake" ? "test-model" : ""),
            temperature: 0.25,
            maxTokens: 1600,
            thinking: "disabled",
            messages: [
                {
                    role: "system",
                    content: `你是家庭教育学习规划师。根据真实证据为一个孩子制定可执行计划，不得诊断疾病，不得虚构能力或成绩。\n
只返回一个 JSON 对象，不要 Markdown，不要解释。格式：\n
{"summary":"一句话总结","rationale":"规划依据","goals":[{"title":"目标名","objective":"目标说明","criteria":{"metric":"可验证标准"}}],"recommended_goal_index":0,"week_items":[{"type":"CHILD_TASK","title":"任务","description":"如何完成和验收","estimated_minutes":20,"due_day":1}]}\n
要求：goals 必须 2 至 3 个，周期由系统统一设为 6 周；week_items 必须 3 至 7 条；type 只能是 ${itemTypes.join("、")}；任务要包含练习、复测或家长行动，控制压力并优先覆盖 learning_priorities。`,
                },
                { role: "user", content: JSON.stringify(context) },
            ],
        }, controller.signal);
        for await (const event of stream) {
            if (event.type === "text")
                content += event.delta;
            if (event.type === "error")
                throw new Error(event.message);
        }
    }
    finally {
        clearTimeout(timer);
    }
    return parseAiPlanOutput(content);
}
export async function generateAiPlanDraft(familyId, planningRequestId, actor, provider = getChatProvider()) {
    const request = await getPlanningRequest(familyId, planningRequestId);
    if (!["pending", "failed"].includes(request.status)) {
        throw new Error(request.status === "awaiting_confirmation" ? "计划草稿已经生成，请先确认" : "当前待规划事项不能生成计划");
    }
    if (provider.name !== "fake" && !hasChatCredentials())
        throw new Error("系统 AI 模型尚未配置");
    if (provider.name !== "fake" && !pickModel(false))
        throw new Error("系统 AI 对话模型尚未配置");
    const locked = await prisma.planningRequest.updateMany({
        where: { id: planningRequestId, familyId, status: { in: ["pending", "failed"] } },
        data: { status: "in_progress", generationError: null },
    });
    if (!locked.count)
        throw new Error("计划正在生成，请勿重复提交");
    let candidateIds = [];
    try {
        const context = await getPlanningContext(familyId, request.childId);
        const output = await collectPlan(provider, context);
        const startDate = startOfToday();
        const endDate = new Date(startDate.getTime() + 42 * 86_400_000);
        const goals = await proposeStageGoals(familyId, request.childId, output.goals.map((goal) => ({ ...goal, startDate, endDate })), actor);
        candidateIds = goals.map((goal) => goal.id);
        const recommendedGoal = goals[output.recommended_goal_index];
        const weekStart = startOfWeek(startDate);
        const plan = await createWeeklyPlan(familyId, recommendedGoal.id, weekStart, output.week_items.map((item) => ({
            type: item.type,
            title: item.title,
            description: item.description,
            estimatedMinutes: item.estimated_minutes,
            dueAt: new Date(weekStart.getTime() + item.due_day * 86_400_000 - 1),
        })), actor, { allowProposedGoal: true, activateGoal: false });
        const draft = {
            summary: output.summary,
            rationale: output.rationale,
            recommended_goal_id: recommendedGoal.id,
            candidate_goal_ids: candidateIds,
            weekly_plan_id: plan.id,
            goals: goals.map((goal, index) => ({
                id: goal.id,
                title: goal.title,
                objective: goal.objective,
                criteria: goal.criteria,
                recommended: index === output.recommended_goal_index,
            })),
            week_items: plan.items.map((item) => ({
                id: item.id,
                type: item.type,
                title: item.title,
                description: item.description,
                estimated_minutes: item.estimatedMinutes,
                due_at: item.dueAt,
            })),
        };
        const updated = await prisma.planningRequest.update({
            where: { id: request.id },
            data: {
                status: "awaiting_confirmation",
                stageGoalId: recommendedGoal.id,
                weeklyPlanId: plan.id,
                aiDraft: draft,
                generatedAt: new Date(),
                generationError: null,
            },
        });
        return { planning_request: updated, draft };
    }
    catch (error) {
        if (candidateIds.length) {
            await prisma.stageGoal.updateMany({
                where: { familyId, id: { in: candidateIds }, status: "PROPOSED" },
                data: { status: "CANCELLED" },
            }).catch(() => undefined);
        }
        const message = error instanceof Error ? error.message : "计划生成失败";
        await prisma.planningRequest.update({
            where: { id: request.id },
            data: { status: "failed", generationError: message },
        });
        throw new Error(message);
    }
}
export async function confirmAiPlanDraft(familyId, planningRequestId, actor) {
    const request = await getPlanningRequest(familyId, planningRequestId);
    if (request.status !== "awaiting_confirmation" || !request.stageGoalId || !request.weeklyPlanId) {
        throw new Error("当前没有可以确认的 AI 计划草稿");
    }
    const draft = (request.aiDraft || {});
    await confirmStageGoal(familyId, request.stageGoalId, "confirm", actor);
    await confirmWeeklyPlan(familyId, request.weeklyPlanId, actor);
    const otherGoalIds = Array.isArray(draft.candidate_goal_ids)
        ? draft.candidate_goal_ids.filter((id) => typeof id === "string" && id !== request.stageGoalId)
        : [];
    if (otherGoalIds.length) {
        await prisma.stageGoal.updateMany({
            where: { familyId, id: { in: otherGoalIds }, status: "PROPOSED" },
            data: { status: "CANCELLED" },
        });
    }
    return prisma.planningRequest.update({
        where: { id: request.id },
        data: { status: "completed", completedAt: new Date(), generationError: null },
    });
}
