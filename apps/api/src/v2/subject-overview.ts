import { prisma } from "../prisma.js";
import { getLearningPriorities, type SignalType } from "./learning-engine.js";
import { normalizeMasteryCriteria } from "../question-bank.js";

/**
 * 学科视角的学情概览：让家长先看到「孩子整体怎么样、哪一科需要管」。
 *
 * 这里全部是规则计算，不调用大模型：
 * - 学科状态由掌握度、待处理信号、近两周练习情况决定；
 * - 某一科「为什么需要重点」直接引用学习信号里的原因，不另写一套解释。
 */

export const SUBJECT_STATUS = ["focus", "progress", "steady", "thin"] as const;
export type SubjectStatus = (typeof SUBJECT_STATUS)[number];

export const SUBJECT_STATUS_TEXT: Record<SubjectStatus, string> = {
  focus: "需重点",
  progress: "进步中",
  steady: "状态稳定",
  thin: "材料不足",
};

const STATUS_ORDER: Record<SubjectStatus, number> = { focus: 0, progress: 1, steady: 2, thin: 3 };
const FOCUS_SIGNALS: SignalType[] = ["PREREQUISITE_GAP", "REPEATED_ERROR", "LOW_MASTERY"];
const LOW_MASTERY_SCORE = 60;
const WEAK_SCORE = 80;

export type SubjectSignal = {
  type: SignalType;
  label?: string | null;
  reason: string;
  priority_score: number;
};

export type SubjectMasteryRow = {
  name: string;
  score: number;
  status: string;
  totalAttempts: number;
  variationCount: number;
  nextReviewAt: Date | null;
  solutionMethod?: string | null;
  standardSteps?: unknown;
  masteryCriteria?: unknown;
};

export type SubjectWrongRow = {
  name: string;
  mistakeCount: number;
  errorReason?: string | null;
  nextReviewAt: Date | null;
};

export type SubjectInput = {
  subject: string;
  masteries: SubjectMasteryRow[];
  wrongItems: SubjectWrongRow[];
  attempts7d: number;
  attempts14d: number;
  pendingHomework: Array<{ title: string; dueDate: Date | null; estimatedMinutes: number | null }>;
  signals: SubjectSignal[];
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function uniqueNames(values: Array<string | null | undefined>) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function average(values: number[]) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function subjectMasteryScore(masteries: SubjectMasteryRow[]) {
  if (!masteries.length) return null;
  // 学科掌握度按练习次数加权，练得多的题型更能代表这一科的真实水平。
  const totalWeight = masteries.reduce((sum, item) => sum + Math.max(1, item.totalAttempts || 0), 0);
  const weighted = masteries.reduce((sum, item) => sum + item.score * Math.max(1, item.totalAttempts || 0), 0);
  return round(weighted / totalWeight);
}

function reviewDueNames(masteries: SubjectMasteryRow[], wrongItems: SubjectWrongRow[], now: Date) {
  const fromMastery = masteries.filter((item) => item.nextReviewAt && item.nextReviewAt <= now).map((item) => item.name);
  const fromWrong = wrongItems.filter((item) => item.nextReviewAt && item.nextReviewAt <= now).map((item) => item.name);
  return uniqueNames([...fromMastery, ...fromWrong]);
}

/**
 * 判定学科状态。优先级：材料不足 → 需重点 → 进步中 → 状态稳定。
 * 每条规则都能在页面上讲清依据，避免出现「AI 感觉不太好」这种结论。
 */
export function classifySubject(input: SubjectInput, now = new Date()) {
  const score = subjectMasteryScore(input.masteries);
  const dueNames = reviewDueNames(input.masteries, input.wrongItems, now);
  const blockingSignals = input.signals.filter((item) => FOCUS_SIGNALS.includes(item.type));
  const hasAnyData = input.masteries.length > 0 || input.wrongItems.length > 0 || input.attempts14d > 0;

  if (!hasAnyData) {
    return { status: "thin" as SubjectStatus, score: null, dueNames, blockingSignals, reason: "这一科还没有作答和练习记录" };
  }

  if (blockingSignals.length || (score !== null && score < LOW_MASTERY_SCORE) || dueNames.length) {
    const reason = blockingSignals[0]?.reason
      || (dueNames.length ? `${dueNames[0]}已到复测时间` : `这一科掌握度 ${score} 分，低于 60`);
    return { status: "focus" as SubjectStatus, score, dueNames, blockingSignals, reason };
  }

  const needsReview = input.masteries.some((item) => item.status === "needs_review");
  if (input.attempts7d > 0 && score !== null && score >= 70 && !needsReview) {
    return { status: "progress" as SubjectStatus, score, dueNames, blockingSignals, reason: "最近一周保持练习，且没有待处理的薄弱点" };
  }

  return { status: "steady" as SubjectStatus, score, dueNames, blockingSignals, reason: "当前没有需要额外处理的薄弱点" };
}

function weakItems(input: SubjectInput) {
  const rows = [
    ...input.masteries
      .filter((item) => item.score < WEAK_SCORE || item.status === "needs_review")
      .map((item) => ({ name: item.name, score: item.score })),
    ...input.wrongItems.map((item) => ({ name: item.name, score: null as number | null })),
  ];
  return rows.slice(0, 5);
}

/** 一句话变化说明，优先讲最需要家长知道的事。 */
export function describeSubjectChange(input: SubjectInput, now = new Date()) {
  const judgement = classifySubject(input, now);
  const repeated = input.wrongItems.filter((item) => item.mistakeCount >= 2);
  const weakest = [...input.masteries].sort((a, b) => a.score - b.score)[0];

  if (judgement.status === "thin") {
    return "还没有足够的作答记录，无法判断这一科的水平，先补一次练习。";
  }
  if (repeated.length) {
    const target = repeated[0];
    return `${target.name}重复出错 ${target.mistakeCount} 次${target.errorReason ? `，${target.errorReason}` : ""}，建议本周单独安排。`;
  }
  if (judgement.dueNames.length) {
    return `${judgement.dueNames[0]}已到复测时间，需要确认是否还记得。`;
  }
  if (weakest && weakest.score < LOW_MASTERY_SCORE) {
    return `${weakest.name}掌握度 ${Math.round(weakest.score)} 分，是这一科当前最低的一项。`;
  }
  if (judgement.status === "progress") {
    return `最近 7 天有 ${input.attempts7d} 次练习，掌握度 ${judgement.score} 分，继续按当前节奏巩固即可。`;
  }
  return `近两周有 ${input.attempts14d} 次练习，没有发现新的薄弱点，暂时不需要额外加量。`;
}

export function buildSubjectRow(input: SubjectInput, now = new Date()) {
  const judgement = classifySubject(input, now);
  return {
    subject: input.subject,
    status: judgement.status,
    status_text: SUBJECT_STATUS_TEXT[judgement.status],
    mastery_score: judgement.score,
    weak_count: weakItems(input).length,
    review_due_count: judgement.dueNames.length,
    attempts_7d: input.attempts7d,
    pending_homework_count: input.pendingHomework.length,
    change_text: describeSubjectChange(input, now),
    top_reason: judgement.reason,
    signals: input.signals.map((item) => ({ type: item.type, label: item.label || null, reason: item.reason, priority_score: item.priority_score })),
  };
}

export function rankSubjectRows<T extends { status: SubjectStatus; mastery_score: number | null; attempts_14d?: number }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    const scoreA = a.mastery_score ?? 101;
    const scoreB = b.mastery_score ?? 101;
    return scoreA - scoreB;
  });
}

function normalizeSubject(value: unknown) {
  const text = String(value || "").trim();
  return text || "其他";
}

export class SubjectOverviewError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

type SubjectBucket = SubjectInput & { attempts14d: number };

async function collectSubjectInputs(familyId: string, childId: string, now: Date) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new SubjectOverviewError("学生不存在或不属于当前家庭", 404);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);

  const [masteries, wrongs, attempts, homework, priorities] = await Promise.all([
    prisma.studentQuestionTypeMastery.findMany({ where: { familyId, childId }, include: { questionType: true } }),
    prisma.wrongQuestionEntry.findMany({
      where: { familyId, childId, status: { notIn: ["mastered", "archived"] } },
      include: { questionType: true },
    }),
    prisma.questionAttempt.findMany({
      where: { familyId, childId, attemptedAt: { gte: fourteenDaysAgo } },
      include: { questionType: { select: { subject: true, name: true } } },
      orderBy: { attemptedAt: "desc" },
    }),
    prisma.homework.findMany({
      where: { familyId, childId, status: { notIn: ["done", "cancelled"] } },
      orderBy: { dueDate: "asc" },
      take: 30,
    }),
    getLearningPriorities(familyId, childId, { limit: 20, now }),
  ]);

  const buckets = new Map<string, SubjectBucket>();
  const bucket = (subject: unknown) => {
    const key = normalizeSubject(subject);
    if (!buckets.has(key)) {
      buckets.set(key, { subject: key, masteries: [], wrongItems: [], attempts7d: 0, attempts14d: 0, pendingHomework: [], signals: [] });
    }
    return buckets.get(key) as SubjectBucket;
  };

  // 先按孩子的关注学科建骨架：没有记录的科目也要出现，并如实显示为「材料不足」。
  for (const subject of child.subjects || []) bucket(subject);

  for (const item of masteries) {
    bucket(item.questionType?.subject).masteries.push({
      name: item.questionType?.name || "未命名题型",
      score: Number(item.masteryScore || 0),
      status: item.status,
      totalAttempts: item.totalAttempts || 0,
      variationCount: item.variationCount || 0,
      nextReviewAt: item.nextReviewAt || null,
    });
  }

  for (const item of wrongs) {
    bucket(item.subject || item.questionType?.subject).wrongItems.push({
      name: item.questionType?.name || item.knowledgePoints?.[0] || "未分类错题",
      mistakeCount: item.mistakeCount || 1,
      errorReason: item.errorReason || null,
      nextReviewAt: item.nextReviewAt || null,
    });
  }

  for (const item of attempts) {
    const target = bucket(item.questionType?.subject);
    target.attempts14d += 1;
    if (item.attemptedAt >= sevenDaysAgo) target.attempts7d += 1;
  }

  for (const item of homework) {
    bucket(item.subject).pendingHomework.push({
      title: item.title,
      dueDate: item.dueDate || null,
      estimatedMinutes: item.estimatedMinutes ?? null,
    });
  }

  for (const priority of priorities.priorities) {
    const key = normalizeSubject(priority.subject);
    if (!buckets.has(key)) continue;
    (buckets.get(key) as SubjectBucket).signals.push({
      type: priority.type,
      label: priority.label,
      reason: priority.reason,
      priority_score: priority.priority_score,
    });
  }

  return { child, priorities, buckets };
}

function buildOverall(rows: Array<ReturnType<typeof buildSubjectRow>>, priorities: Awaited<ReturnType<typeof getLearningPriorities>>) {
  const focusRows = rows.filter((row) => row.status === "focus");
  const scored = rows.map((row) => row.mastery_score).filter((score): score is number => typeof score === "number");
  const metrics = {
    subject_count: rows.filter((row) => row.status !== "thin").length,
    mastery_average: scored.length ? round(scored.reduce((sum, value) => sum + value, 0) / scored.length) : null,
    review_due_count: rows.reduce((sum, row) => sum + row.review_due_count, 0),
  };

  let conclusion: string;
  if (!rows.length || !scored.length) {
    conclusion = "还没有足够的学习记录，先录入一次作业或错题，才能判断各科情况";
  } else if (focusRows.length === 1) {
    conclusion = `整体${focusRows[0].mastery_score !== null && focusRows[0].mastery_score < 60 ? "需要关注" : "基本稳定"}，${focusRows[0].subject}是目前最需要优先处理的一科`;
  } else if (focusRows.length > 1) {
    conclusion = `${focusRows.map((row) => row.subject).join("、")}需要重点安排，其余学科按当前节奏继续`;
  } else {
    conclusion = "各科暂时都没有需要额外处理的薄弱点，按当前节奏继续即可";
  }

  const tags = [
    `${rows.reduce((sum, row) => sum + row.weak_count, 0)} 个薄弱知识点`,
    `${metrics.review_due_count} 项复测到期`,
    `${priorities.signal_count} 条待处理信号`,
  ];

  return { conclusion, tags, metrics, active_goal: priorities.active_goal, planning_required: priorities.planning_required };
}

export async function getSubjectOverview(familyId: string, childId: string, now = new Date()) {
  const { child, priorities, buckets } = await collectSubjectInputs(familyId, childId, now);
  const rows = [...buckets.values()]
    .map((input) => ({
      ...buildSubjectRow(input, now),
      attempts_14d: input.attempts14d,
      pending_homework: input.pendingHomework.map((item) => ({
        title: item.title,
        due_date: item.dueDate,
        estimated_minutes: item.estimatedMinutes,
      })),
      weak_items: weakItems(input),
    }))
    // 关注学科即使暂时没有记录也要展示，只有既不属于关注学科又没有数据的「其他」才隐藏。
    .filter((row) => row.subject !== "其他" || row.status !== "thin");

  const ranked = rankSubjectRows(rows).map(({ attempts_14d, ...rest }) => rest);
  return {
    child: { child_id: child.id, name: child.name, grade: child.grade },
    as_of: now.toISOString(),
    overall: buildOverall(rows, priorities),
    subjects: ranked,
  };
}

/** 学科详情：判断 + 需要先解决的问题 + 后续规划建议，全部由规则产出。 */
export async function getSubjectDetail(familyId: string, childId: string, subject: string, now = new Date()) {
  const { buckets, priorities } = await collectSubjectInputs(familyId, childId, now);
  const key = normalizeSubject(subject);
  const input = buckets.get(key);
  if (!input) throw new SubjectOverviewError("没有这一科的学习记录", 404);

  const row = buildSubjectRow(input, now);
  const masteries = await prisma.studentQuestionTypeMastery.findMany({
    where: { familyId, childId, questionType: { subject: key } },
    include: { questionType: true },
  });
  const byName = new Map(masteries.map((item) => [item.questionType?.name || "", item]));

  const signalOrder: SignalType[] = ["PREREQUISITE_GAP", "REPEATED_ERROR", "REVIEW_DUE", "LOW_MASTERY", "VARIATION_GAP"];
  const sortedSignals = [...input.signals].sort((a, b) => signalOrder.indexOf(a.type) - signalOrder.indexOf(b.type) || b.priority_score - a.priority_score);
  const gaps = sortedSignals.slice(0, 3).map((signal) => {
    const mastery = byName.get(String(signal.label || ""));
    return {
      name: signal.label || key,
      mastery_score: mastery ? round(Number(mastery.masteryScore || 0)) : null,
      type: signal.type,
      why: signal.reason,
      evidence: mastery
        ? `练习 ${mastery.totalAttempts} 次 · 独立作答 ${mastery.independentAttempts} 次 · 覆盖 ${mastery.variationCount} 种变式`
        : null,
    };
  });

  const fallbackWeakest = [...input.masteries].sort((a, b) => a.score - b.score)[0];
  const topSignal = sortedSignals[0] || null;
  const advice = buildAdvice(topSignal, fallbackWeakest, byName.get(String(topSignal?.label || ""))?.questionType, row);

  return {
    child: { child_id: childId },
    subject: key,
    as_of: now.toISOString(),
    status: row.status,
    status_text: row.status_text,
    mastery_score: row.mastery_score,
    judgement: buildJudgement(row, key),
    gaps,
    advice,
    tasks: input.pendingHomework.map((item) => ({
      title: item.title,
      due_date: item.dueDate,
      estimated_minutes: item.estimatedMinutes,
    })),
    planning_required: priorities.planning_required,
  };
}

function buildJudgement(row: ReturnType<typeof buildSubjectRow>, subject: string) {
  if (row.status === "thin") return `${subject}还没有足够的记录，暂时无法判断，先补一次练习。`;
  if (row.status === "focus") {
    return `${subject}整体掌握度 ${row.mastery_score ?? "—"} 分，${row.top_reason}，本周需要重点安排。`;
  }
  if (row.status === "progress") return `${subject}整体掌握度 ${row.mastery_score ?? "—"} 分，最近保持练习，按当前节奏继续即可。`;
  return `${subject}整体掌握度 ${row.mastery_score ?? "—"} 分，当前没有需要额外处理的薄弱点。`;
}

/**
 * 由规则直接生成建议，不调用大模型：
 * 动作来自信号类型，通过标准来自题型的掌握判定规则，教学方式来自题型解法或家庭方法。
 */
export function buildAdvice(
  signal: SubjectSignal | null,
  fallbackMastery: SubjectMasteryRow | undefined,
  masteryRow: { solutionMethod?: string | null; standardSteps?: unknown; masteryCriteria?: unknown } | undefined,
  row: { subject: string },
) {
  const criteria = normalizeMasteryCriteria(masteryRow?.masteryCriteria);
  const steps = Array.isArray(masteryRow?.standardSteps) ? (masteryRow?.standardSteps as unknown[]).map(String) : [];
  const method = String(masteryRow?.solutionMethod || steps[0] || "").trim()
    || "先让孩子自己说思路，家长不直接给答案，卡住时只给一个小提示";

  const target = signal?.label || fallbackMastery?.name || row.subject;
  const plan: Record<SignalType | "default", { action: string; minutes: number }> = {
    PREREQUISITE_GAP: { action: `先补前置知识点的 2 道基础题，再回到「${target}」`, minutes: 10 },
    REPEATED_ERROR: { action: `「${target}」易错点变式题 3 道 + 迁移题 1 道`, minutes: 12 },
    REVIEW_DUE: { action: `「${target}」快速复测 3 道`, minutes: 5 },
    LOW_MASTERY: { action: `「${target}」基础巩固 3 道`, minutes: 12 },
    VARIATION_GAP: { action: `「${target}」增加 2 种变式练习`, minutes: 12 },
    default: { action: `围绕「${target}」做 3 道基础练习`, minutes: 10 },
  };
  const chosen = signal ? plan[signal.type] : plan.default;
  const retestHours = criteria.delayedHours;
  const retestDate = fallbackMastery?.nextReviewAt;

  return {
    target,
    action: chosen.action,
    estimated_minutes: chosen.minutes,
    method,
    pass_criteria: `掌握分达到 ${criteria.minScore}，累计练习不少于 ${criteria.minAttempts} 次，覆盖 ${criteria.minVariations} 种变式，并包含 1 道迁移题`,
    retest: retestDate
      ? `${Math.max(1, Math.round((retestDate.getTime() - Date.now()) / 3_600_000))} 小时后做延迟复测，通过后再进入下一个知识点`
      : `${retestHours} 小时后做延迟复测，通过后再进入下一个知识点`,
    basis: signal?.reason || "该题型掌握度低于学科平均水平",
  };
}
