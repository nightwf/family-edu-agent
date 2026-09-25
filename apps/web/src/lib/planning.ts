/**
 * 待规划提示的组装逻辑，口径与小程序一致（miniprogram/utils/planning.js）。
 * 禾芽发现需要重新规划后，直接调用内置 AI 生成草稿，家长确认后生效。
 */

export type PlanningCard = {
  id: string;
  statusText: string;
  reason: string;
  focusText: string;
  actionText: string;
  canGenerate: boolean;
  canConfirm: boolean;
  draft: any | null;
  error: string;
};

export function buildPlanningCard(child: any, learning: any, planningRequest: any): PlanningCard | null {
  if (!planningRequest || !child) return null;
  const top = learning && learning.top;
  const reason =
    planningRequest.trigger_reason ||
    (top && top.reason) ||
    "当前的学习记录显示需要重新安排下一阶段的学习重点";
  const status = planningRequest.status || "pending";
  const draft = planningRequest.ai_draft || null;
  const recommended = draft?.goals?.find((goal: any) => goal.recommended) || draft?.goals?.[0];
  const statusMap: Record<string, string> = {
    pending: "待制定",
    in_progress: "AI 正在规划",
    awaiting_confirmation: "待家长确认",
    failed: "生成失败",
    completed: "已生效",
  };
  return {
    id: planningRequest.id,
    statusText: statusMap[status] || "待制定",
    reason,
    focusText: recommended?.title || (top ? top.label || top.subject || "待确认" : "需要先补充学习记录"),
    actionText: status === "failed" ? "重新生成" : status === "awaiting_confirmation" ? "确认并开始" : "让 AI 制定计划",
    canGenerate: status === "pending" || status === "failed",
    canConfirm: status === "awaiting_confirmation" && Boolean(draft),
    draft,
    error: planningRequest.generation_error || "",
  };
}
