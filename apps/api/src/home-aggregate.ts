import { ensurePlanningRequest, getLearningPriorities } from "./v2/learning-engine.js";
import { getSubjectOverview } from "./v2/subject-overview.js";
import { loadMobileHomeInsights } from "./mobile-home.js";

/**
 * 首页共用的学情聚合：整体状态、各学科情况、待规划事项。
 *
 * 电脑端和小程序端必须看到同一套结论，所以聚合只在这里算一次，
 * 两个接口都从这里取，避免两端各写一套口径。
 * 这些都是规则计算（不调用大模型），任何一项失败都不能影响首页其它数据。
 */

export async function buildHomeSubjectOverview(familyId: string, childId: string) {
  try {
    return await getSubjectOverview(familyId, childId);
  } catch {
    return null;
  }
}

export async function buildHomeLearningSection(familyId: string, childId: string) {
  try {
    const priorities = await getLearningPriorities(familyId, childId, { limit: 3 });
    const planningRequest = await ensurePlanningRequest(familyId, childId);
    return {
      learning_priorities: {
        top: priorities.priorities[0] || null,
        priorities: priorities.priorities,
        signal_count: priorities.signal_count,
        planning_required: priorities.planning_required,
        active_goal: priorities.active_goal,
      },
      planning_request: planningRequest
        ? {
            id: planningRequest.id,
            status: planningRequest.status,
            trigger_reason: planningRequest.triggerReason,
            ai_draft: planningRequest.aiDraft,
            generated_at: planningRequest.generatedAt,
            generation_error: planningRequest.generationError,
            created_at: planningRequest.createdAt,
          }
        : null,
    };
  } catch {
    return { learning_priorities: null, planning_request: null };
  }
}

export async function loadHomeAggregate(familyId: string, childId: string | null | undefined) {
  const targetChildId = childId || null;
  const [insights, learning, subjectOverview] = await Promise.all([
    loadMobileHomeInsights(familyId, targetChildId),
    targetChildId
      ? buildHomeLearningSection(familyId, targetChildId)
      : Promise.resolve({ learning_priorities: null, planning_request: null }),
    targetChildId ? buildHomeSubjectOverview(familyId, targetChildId) : Promise.resolve(null),
  ]);

  return {
    ...insights,
    ...learning,
    subject_overview: subjectOverview,
  };
}
