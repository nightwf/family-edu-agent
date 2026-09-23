import { prisma } from "../prisma.js";
import { getFamilyPolicy } from "./family-policy.js";
import { getChildState } from "./child-state.js";
import { getLearningPriorities } from "./learning-engine.js";
export async function getPlanningContext(familyId, childId) {
    const [child, familyPolicy, childState, activeGoal, knowledgeGaps, learning] = await Promise.all([
        prisma.child.findFirst({ where: { id: childId, familyId } }),
        getFamilyPolicy(familyId),
        getChildState(familyId, childId),
        prisma.stageGoal.findFirst({
            where: { familyId, childId, status: { in: ["CONFIRMED", "ACTIVE"] } },
            orderBy: { endDate: "desc" },
        }),
        prisma.childKnowledgeState.findMany({
            where: {
                familyId,
                childId,
                status: { in: ["LEARNING", "PARTIAL", "NEEDS_REVIEW", "UNASSESSED"] },
            },
            include: { knowledgeNode: true },
            orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "desc" }],
            take: 20,
        }),
        getLearningPriorities(familyId, childId, { limit: 5 }),
    ]);
    if (!child)
        throw new Error("学生不存在或不属于当前家庭");
    return {
        child: {
            child_id: child.id,
            name: child.name,
            grade: child.grade,
            subjects: child.subjects,
        },
        current_goal: activeGoal,
        current_state: childState,
        knowledge_gaps: knowledgeGaps.map((item) => ({
            knowledge_node_id: item.knowledgeNodeId,
            title: item.knowledgeNode.title,
            status: item.status,
            score: item.score,
            next_review_at: item.nextReviewAt,
        })),
        family_policy: familyPolicy,
        learning_priorities: learning.priorities,
        learning_signals: {
            active_count: learning.signal_count,
            planning_required: learning.planning_required,
        },
        generation_requirements: {
            goal_count: 3,
            goal_horizon_weeks: 6,
            required_fields: ["title", "objective", "criteria", "start_date", "end_date"],
            priority_rule: "生成目标时必须优先覆盖 learning_priorities，并说明每条优先级对应的信号依据。",
        },
    };
}
