/**
 * 学科视角的展示映射。
 * 状态与排序都由服务端规则算好，这里只负责翻译成界面文案和样式类，
 * 避免前端另算一套口径导致和家长看到的解释不一致。
 */

const STATUS_CLASS = {
  focus: "is-focus",
  progress: "is-progress",
  steady: "is-steady",
  thin: "is-thin"
};

const CHARACTER_BY_STATUS = {
  focus: "thinking",
  progress: "progress",
  steady: "stable",
  thin: "stable"
};

function scoreText(score) {
  return typeof score === "number" && Number.isFinite(score) ? String(Math.round(score)) : "—";
}

/** 人物状态跟着最需要关注的那一科走，复测到期时用复测形象。 */
function pickCharacterState(subjects) {
  const rows = subjects || [];
  const focus = rows.find((item) => item.status === "focus");
  if (focus) return focus.review_due_count > 0 ? "review" : CHARACTER_BY_STATUS.focus;
  const progress = rows.find((item) => item.status === "progress");
  if (progress) return CHARACTER_BY_STATUS.progress;
  return "stable";
}

function mapSubjectRow(row) {
  const meta = [`薄弱知识点 ${row.weak_count || 0}`, `待复测 ${row.review_due_count || 0}`];
  if (row.attempts_7d) meta.push(`本周练习 ${row.attempts_7d} 次`);
  return {
    ...row,
    statusClass: STATUS_CLASS[row.status] || "is-thin",
    scoreText: scoreText(row.mastery_score),
    hasScore: row.mastery_score !== null && row.mastery_score !== undefined,
    scorePercent: Math.max(4, Math.min(100, Math.round(Number(row.mastery_score) || 0))),
    metaText: meta.join(" · "),
    enterText: `查看${row.subject}规划建议`
  };
}

function mapSubjectRows(rows) {
  return (rows || []).map(mapSubjectRow);
}

function mapOverall(overall, evidenceCount) {
  const metrics = (overall && overall.metrics) || {};
  return {
    conclusion: (overall && overall.conclusion) || "还没有足够的学习记录，先录入一次作业或错题",
    tags: (overall && overall.tags) || [],
    metrics: [
      { value: metrics.subject_count === undefined || metrics.subject_count === null ? "—" : String(metrics.subject_count), label: "有记录学科" },
      { value: metrics.mastery_average === undefined || metrics.mastery_average === null ? "—" : String(Math.round(metrics.mastery_average)), label: "掌握度均值" },
      { value: evidenceCount === null || evidenceCount === undefined ? "—" : String(evidenceCount), label: "本周证据" },
      { value: metrics.review_due_count === undefined || metrics.review_due_count === null ? "0" : String(metrics.review_due_count), label: "待复测" }
    ]
  };
}

function mapGaps(gaps) {
  return (gaps || []).map((item) => ({
    ...item,
    scoreText: scoreText(item.mastery_score),
    hasScore: item.mastery_score !== null && item.mastery_score !== undefined
  }));
}

function mapAdvice(advice) {
  if (!advice) return null;
  return {
    ...advice,
    rows: [
      { label: "本次安排", value: advice.action },
      { label: "教学方式", value: advice.method },
      { label: "通过标准", value: advice.pass_criteria },
      { label: "复测安排", value: advice.retest },
      { label: "判断依据", value: advice.basis }
    ].filter((item) => Boolean(item.value))
  };
}

module.exports = {
  STATUS_CLASS,
  pickCharacterState,
  mapSubjectRow,
  mapSubjectRows,
  mapOverall,
  mapGaps,
  mapAdvice
};
