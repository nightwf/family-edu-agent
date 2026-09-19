/**
 * 待规划提示的组装逻辑。
 * 禾芽只负责发现“需要重新规划”并给出可直接发送的指令，
 * 计划本身仍然由 WorkBuddy 读取学习优先级后制定。
 */
function buildPlanningCard(child, learning, planningRequest) {
  if (!planningRequest || !child) return null;
  const top = learning && learning.top;
  const name = child.name || "孩子";
  const reason = planningRequest.trigger_reason
    || (top && top.reason)
    || "当前的学习记录显示需要重新安排下一阶段的学习重点";
  const instruction = top
    ? `请读取${name}当前的学习优先级（第一优先：${top.label || top.subject}，原因：${top.reason}），制定接下来 4 周的阶段目标和本周学习计划。`
    : `请读取${name}当前的学习优先级，制定接下来 4 周的阶段目标和本周学习计划。`;
  return {
    id: planningRequest.id,
    statusText: planningRequest.status === "in_progress" ? "规划中" : "待规划",
    reason,
    focusText: top ? (top.label || top.subject || "待确认") : "需要先补充学习记录",
    instruction
  };
}

module.exports = { buildPlanningCard };
