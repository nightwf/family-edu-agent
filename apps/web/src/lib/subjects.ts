/**
 * 学科视角的展示映射，口径与小程序一致（miniprogram/utils/subjects.js）。
 * 状态与排序都由服务端规则算好，这里只翻译成界面文案和样式类。
 */

export const STATUS_CLASS: Record<string, string> = {
  focus: "is-focus",
  progress: "is-progress",
  steady: "is-steady",
  thin: "is-thin",
};

const CHARACTER_BY_STATUS: Record<string, string> = {
  focus: "thinking",
  progress: "progress",
  steady: "stable",
  thin: "stable",
};

function scoreText(score: unknown) {
  return typeof score === "number" && Number.isFinite(score) ? String(Math.round(score)) : "—";
}

/** 人物状态跟着最需要关注的那一科走，复测到期时用复测形象。 */
export function pickCharacterState(subjects: any[] | undefined) {
  const rows = subjects || [];
  const focus = rows.find((item) => item.status === "focus");
  if (focus) return focus.review_due_count > 0 ? "review" : CHARACTER_BY_STATUS.focus;
  const progress = rows.find((item) => item.status === "progress");
  if (progress) return CHARACTER_BY_STATUS.progress;
  return "stable";
}

export type SubjectRow = {
  subject: string;
  status: string;
  status_text: string;
  mastery_score: number | null;
  statusClass: string;
  scoreText: string;
  hasScore: boolean;
  scorePercent: number;
  metaText: string;
  enterText: string;
  change_text?: string;
  weak_count?: number;
  review_due_count?: number;
};

export function mapSubjectRow(row: any): SubjectRow {
  const meta = [`薄弱知识点 ${row.weak_count || 0}`, `待复测 ${row.review_due_count || 0}`];
  if (row.attempts_7d) meta.push(`本周练习 ${row.attempts_7d} 次`);
  return {
    ...row,
    statusClass: STATUS_CLASS[row.status] || "is-thin",
    scoreText: scoreText(row.mastery_score),
    hasScore: row.mastery_score !== null && row.mastery_score !== undefined,
    scorePercent: Math.max(4, Math.min(100, Math.round(Number(row.mastery_score) || 0))),
    metaText: meta.join(" · "),
    enterText: `查看${row.subject}规划建议`,
  };
}

export function mapSubjectRows(rows: any[] | undefined): SubjectRow[] {
  return (rows || []).map(mapSubjectRow);
}

export type OverallMetric = { value: string; label: string };

export function mapOverall(overall: any, evidenceCount?: number | null) {
  const metrics = (overall && overall.metrics) || {};
  return {
    conclusion: (overall && overall.conclusion) || "还没有足够的学习记录，先录入一次作业或错题",
    tags: (overall && overall.tags) || [],
    metrics: [
      {
        value: metrics.subject_count === undefined || metrics.subject_count === null ? "—" : String(metrics.subject_count),
        label: "有记录学科",
      },
      {
        value:
          metrics.mastery_average === undefined || metrics.mastery_average === null
            ? "—"
            : String(Math.round(metrics.mastery_average)),
        label: "掌握度均值",
      },
      {
        value: evidenceCount === null || evidenceCount === undefined ? "—" : String(evidenceCount),
        label: "本周证据",
      },
      {
        value:
          metrics.review_due_count === undefined || metrics.review_due_count === null
            ? "0"
            : String(metrics.review_due_count),
        label: "待复测",
      },
    ] as OverallMetric[],
  };
}

/** 学科卡片的状态样式：与小程序同一套米色/陶土色/青绿色语义。 */
export function subjectTone(statusClass: string) {
  if (statusClass === "is-focus") {
    return {
      card: "border-[#ecc7ba] bg-[#fff7f3]",
      pill: "bg-accent-soft text-accent",
      score: "text-accent",
      bar: "bg-gradient-to-r from-[#d3644c] to-[#e79b7f]",
    };
  }
  if (statusClass === "is-progress") {
    return { card: "border-line bg-panel", pill: "bg-teal-soft text-teal", score: "text-teal", bar: "bg-gradient-to-r from-teal to-[#3aa79a]" };
  }
  if (statusClass === "is-thin") {
    return { card: "border-line bg-panel", pill: "bg-[#eef1f0] text-[#6d7c80]", score: "text-teal", bar: "bg-gradient-to-r from-teal to-[#3aa79a]" };
  }
  return { card: "border-line bg-panel", pill: "bg-gold-soft text-[#80601a]", score: "text-teal", bar: "bg-gradient-to-r from-teal to-[#3aa79a]" };
}
