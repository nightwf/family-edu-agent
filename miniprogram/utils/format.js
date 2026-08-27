function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function childName(children, childId) {
  const child = (children || []).find((item) => item.id === childId);
  return child ? child.name : "-";
}

function subjectLabel(subject) {
  return subject || "综合";
}

function wrongStatus(status) {
  const labels = {
    pending_correction: "待订正",
    strengthening: "巩固中",
    mastered: "已掌握",
    needs_review: "需复习",
    archived: "已归档"
  };
  return labels[status] || status || "未知";
}

function wrongTone(status) {
  if (status === "mastered") return "pill";
  if (status === "needs_review" || status === "pending_correction") return "pill-danger";
  return "pill-warn";
}

function masteryStatus(status) {
  const labels = {
    unassessed: "未评估",
    learning: "学习中",
    basic: "基本掌握",
    mastered: "已掌握",
    needs_review: "需复习"
  };
  return labels[status] || status || "未评估";
}

function homeworkStatus(status) {
  const labels = {
    pending: "待完成",
    in_progress: "进行中",
    done: "已完成",
    cancelled: "已取消"
  };
  return labels[status] || status || "待完成";
}

function homeworkTone(status) {
  return status === "done" ? "pill" : "pill-warn";
}

function paperStatus(status) {
  const labels = {
    draft: "草稿",
    ready: "待练习",
    in_progress: "练习中",
    completed: "已完成",
    archived: "已归档"
  };
  return labels[status] || status || "未知";
}

function planStatus(status) {
  const labels = {
    draft: "草稿",
    active: "进行中",
    completed: "已完成",
    archived: "已归档"
  };
  return labels[status] || status || "未知";
}

function taskStatus(status) {
  const labels = {
    pending: "待开始",
    in_progress: "进行中",
    completed: "已完成",
    skipped: "已跳过"
  };
  return labels[status] || status || "待开始";
}

function difficultyLabel(difficulty) {
  const labels = {
    basic: "基础",
    advanced: "进阶",
    transfer: "迁移",
    review: "复习"
  };
  return labels[difficulty] || difficulty || "基础";
}

function safeText(value) {
  if (value === undefined || value === null || value === "") return "未填写";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function joinTags(value) {
  if (Array.isArray(value)) return value.join("、") || "未标注";
  return value || "未标注";
}

module.exports = {
  formatDate,
  childName,
  subjectLabel,
  wrongStatus,
  wrongTone,
  masteryStatus,
  homeworkStatus,
  homeworkTone,
  paperStatus,
  planStatus,
  taskStatus,
  difficultyLabel,
  safeText,
  joinTags
};
