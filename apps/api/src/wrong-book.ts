import { prisma } from "./prisma.js";
import {
  QuestionBankError,
  recalculateMastery,
  recordQuestionAttempt,
  requireChild,
  requireQuestion,
  requireQuestionType,
} from "./question-bank.js";

export const WRONG_QUESTION_STATUSES = ["pending_correction", "strengthening", "mastered", "needs_review", "archived"] as const;
export const PAPER_STATUSES = ["draft", "ready", "in_progress", "completed", "archived"] as const;
export const PLAN_STATUSES = ["draft", "active", "completed", "archived"] as const;
export const TASK_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;

const DEFAULT_WRONG_MASTERY_CRITERIA = {
  minScore: 80,
  minIndependentCorrect: 3,
  minSessions: 2,
  requireOriginalCorrection: true,
  requireTransfer: true,
  requireDelayedReview: true,
  delayedHours: 24,
};

type WrongMasteryAttempt = {
  id: string;
  questionId: string;
  isCorrect: boolean | null;
  score: number | null;
  usedHint: boolean;
  isIndependent: boolean | null;
  isOriginalCorrection: boolean;
  variationType: string | null;
  sessionId: string | null;
  attemptedAt: Date;
  question: { difficulty: string; variationType: string | null };
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function value(input: any, snakeName: string, camelName: string) {
  return input?.[snakeName] !== undefined ? input[snakeName] : input?.[camelName];
}

function stringArray(input: unknown) {
  if (Array.isArray(input)) return input.map(String).map((item) => item.trim()).filter(Boolean);
  return String(input || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function pageValues(input: any = {}) {
  const limit = Math.min(100, Math.max(1, Number(input.limit || 20)));
  const offset = Math.max(0, Number(input.offset || 0));
  return { limit, offset };
}

function dateValue(input: unknown) {
  if (!input) return undefined;
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) throw new QuestionBankError("日期格式无效");
  return date;
}

function attemptPassed(attempt: WrongMasteryAttempt) {
  return attempt.isCorrect ?? (attempt.score !== null && attempt.score >= 60);
}

function isIndependent(attempt: WrongMasteryAttempt) {
  return attempt.isIndependent ?? !attempt.usedHint;
}

export function normalizeWrongMasteryCriteria(valueInput: unknown) {
  const input = objectValue(valueInput);
  return {
    minScore: Math.min(100, positiveNumber(input.minScore, DEFAULT_WRONG_MASTERY_CRITERIA.minScore)),
    minIndependentCorrect: Math.max(1, Math.round(positiveNumber(input.minIndependentCorrect, DEFAULT_WRONG_MASTERY_CRITERIA.minIndependentCorrect))),
    minSessions: Math.max(1, Math.round(positiveNumber(input.minSessions, DEFAULT_WRONG_MASTERY_CRITERIA.minSessions))),
    requireOriginalCorrection: input.requireOriginalCorrection === undefined ? true : Boolean(input.requireOriginalCorrection),
    requireTransfer: input.requireTransfer === undefined ? true : Boolean(input.requireTransfer),
    requireDelayedReview: input.requireDelayedReview === undefined ? true : Boolean(input.requireDelayedReview),
    delayedHours: Math.max(1, positiveNumber(input.delayedHours, DEFAULT_WRONG_MASTERY_CRITERIA.delayedHours)),
  };
}

export function calculateWrongQuestionMastery(
  attemptsInput: WrongMasteryAttempt[],
  originalQuestionId: string,
  criteriaInput: unknown,
  previousCalculatedStatus = "pending_correction",
  now = new Date(),
) {
  const criteria = normalizeWrongMasteryCriteria(criteriaInput);
  const attempts = [...attemptsInput].sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
  const correctIndependent = attempts.filter((attempt) => attemptPassed(attempt) && isIndependent(attempt));
  const originalCorrectionPassed = attempts.some((attempt) => (
    attempt.questionId === originalQuestionId && attempt.isOriginalCorrection && attemptPassed(attempt)
  ));
  const variantAttempts = correctIndependent.filter((attempt) => attempt.questionId !== originalQuestionId || !attempt.isOriginalCorrection);
  const variantKeys = new Set(variantAttempts.map((attempt) => `${attempt.questionId}:${attempt.variationType || attempt.question.variationType || "standard"}`));
  const independentCorrectVariants = variantKeys.size;
  const sessionKeys = new Set(correctIndependent.map((attempt) => attempt.sessionId || attempt.attemptedAt.toISOString().slice(0, 10)));
  const sessionCount = sessionKeys.size;
  const transferPassed = correctIndependent.some((attempt) => (
    attempt.variationType === "transfer" || attempt.question.variationType === "transfer" || attempt.question.difficulty === "transfer"
  ));
  const firstIndependentCorrect = correctIndependent[0];
  const delayedMs = criteria.delayedHours * 60 * 60 * 1000;
  const delayedReviewPassed = Boolean(firstIndependentCorrect && correctIndependent.some((attempt) => (
    attempt.id !== firstIndependentCorrect.id
    && attempt.attemptedAt.getTime() - firstIndependentCorrect.attemptedAt.getTime() >= delayedMs
  )));

  const components = {
    originalCorrection: originalCorrectionPassed ? 20 : 0,
    independentVariants: Math.min(1, independentCorrectVariants / criteria.minIndependentCorrect) * 30,
    sessions: Math.min(1, sessionCount / criteria.minSessions) * 15,
    transfer: transferPassed ? 15 : 0,
    delayedReview: delayedReviewPassed ? 20 : 0,
  };
  const masteryScore = Math.round(Object.values(components).reduce((sum, score) => sum + score, 0) * 10) / 10;
  const requirementsPassed = masteryScore >= criteria.minScore
    && (!criteria.requireOriginalCorrection || originalCorrectionPassed)
    && independentCorrectVariants >= criteria.minIndependentCorrect
    && sessionCount >= criteria.minSessions
    && (!criteria.requireTransfer || transferPassed)
    && (!criteria.requireDelayedReview || delayedReviewPassed);
  const latest = attempts.at(-1);

  let calculatedStatus = attempts.length ? "strengthening" : "pending_correction";
  if (requirementsPassed) calculatedStatus = "mastered";
  if (latest && !attemptPassed(latest) && (previousCalculatedStatus === "mastered" || requirementsPassed)) calculatedStatus = "needs_review";

  const nextReviewDays = calculatedStatus === "mastered" ? 7 : calculatedStatus === "needs_review" ? 1 : 2;
  const nextReviewAt = attempts.length
    ? new Date(Math.max(now.getTime(), attempts.at(-1)!.attemptedAt.getTime()) + nextReviewDays * 86_400_000)
    : null;

  return {
    calculatedStatus,
    masteryScore,
    nextReviewAt,
    masteredAt: calculatedStatus === "mastered" ? now : null,
    evidence: {
      criteria,
      components: Object.fromEntries(Object.entries(components).map(([key, score]) => [key, Math.round(score * 10) / 10])),
      originalCorrectionPassed,
      independentCorrectVariants,
      sessions: sessionCount,
      transferPassed,
      delayedReviewPassed,
      totalLinkedAttempts: attempts.length,
      latestAttemptPassed: latest ? attemptPassed(latest) : null,
      requirementsPassed,
    },
  };
}

export async function requireWrongQuestion(familyId: string, wrongQuestionId: string) {
  const item = await prisma.wrongQuestionEntry.findFirst({ where: { id: wrongQuestionId, familyId } });
  if (!item) throw new QuestionBankError("错题不存在或不属于当前家庭", 404);
  return item;
}

export async function requirePracticePaper(familyId: string, practicePaperId: string) {
  const item = await prisma.practicePaper.findFirst({ where: { id: practicePaperId, familyId } });
  if (!item) throw new QuestionBankError("练习试卷不存在或不属于当前家庭", 404);
  return item;
}

export async function requireRemediationPlan(familyId: string, remediationPlanId: string) {
  const item = await prisma.remediationPlan.findFirst({ where: { id: remediationPlanId, familyId } });
  if (!item) throw new QuestionBankError("教学规划不存在或不属于当前家庭", 404);
  return item;
}

export async function saveWrongQuestion(familyId: string, input: any) {
  const [child, question] = await Promise.all([
    requireChild(familyId, input.child_id),
    requireQuestion(familyId, input.question_id),
  ]);
  if (input.question_type_id && input.question_type_id !== question.questionTypeId) {
    throw new QuestionBankError("question_type_id 与题目所属题型不一致");
  }
  const sourceAttemptId = value(input, "source_attempt_id", "sourceAttemptId");
  let sourceAttempt: any = null;
  if (sourceAttemptId) {
    sourceAttempt = await prisma.questionAttempt.findFirst({ where: { id: sourceAttemptId, familyId, childId: child.id, questionId: question.id } });
    if (!sourceAttempt) throw new QuestionBankError("来源作答不存在、学生不一致或不属于当前家庭", 404);
  }
  const existing = await prisma.wrongQuestionEntry.findUnique({ where: { childId_questionId: { childId: child.id, questionId: question.id } } });
  const wrongAt = dateValue(value(input, "wrong_at", "wrongAt")) || sourceAttempt?.attemptedAt || new Date();
  const type = question.questionType;
  const commonData = {
    subject: input.subject || type.subject,
    grade: input.grade === undefined ? type.grade : input.grade,
    textbook: input.textbook === undefined ? type.textbook : input.textbook,
    chapter: input.chapter === undefined ? type.chapter : input.chapter,
    knowledgePoints: input.knowledge_points === undefined ? type.knowledgePoints : stringArray(input.knowledge_points),
    latestSourceAttemptId: sourceAttemptId,
    latestWrongAnswer: value(input, "wrong_answer", "wrongAnswer") === undefined ? sourceAttempt?.studentAnswer : value(input, "wrong_answer", "wrongAnswer"),
    errorReason: value(input, "error_reason", "errorReason") === undefined ? sourceAttempt?.errorReason : value(input, "error_reason", "errorReason"),
    errorCategory: value(input, "error_category", "errorCategory"),
    workbuddyAnalysis: value(input, "workbuddy_analysis", "workbuddyAnalysis"),
    correctionMethod: value(input, "correction_method", "correctionMethod"),
    keyLearningPoint: value(input, "key_learning_point", "keyLearningPoint"),
    source: input.source || "workbuddy",
  };
  const isSameSource = Boolean(existing && sourceAttemptId && existing.latestSourceAttemptId === sourceAttemptId);
  const item = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.wrongQuestionEntry.update({
        where: { id: existing.id },
        data: {
          ...commonData,
          lastWrongAt: wrongAt,
          mistakeCount: isSameSource ? existing.mistakeCount : { increment: 1 },
          calculatedStatus: existing.calculatedStatus === "mastered" ? "needs_review" : existing.calculatedStatus,
          status: existing.manualStatus || (existing.calculatedStatus === "mastered" ? "needs_review" : existing.status),
          masteredAt: existing.calculatedStatus === "mastered" ? null : existing.masteredAt,
        },
      })
      : await tx.wrongQuestionEntry.create({
        data: {
          familyId,
          childId: child.id,
          questionId: question.id,
          questionTypeId: question.questionTypeId,
          ...commonData,
          firstWrongAt: wrongAt,
          lastWrongAt: wrongAt,
        },
      });
    if (sourceAttemptId) await tx.questionAttempt.update({ where: { id: sourceAttemptId }, data: { wrongQuestionId: saved.id } });
    return saved;
  });
  return getWrongQuestion(familyId, item.id);
}

export async function listWrongQuestions(familyId: string, input: any = {}) {
  const { limit, offset } = pageValues(input);
  if (input.child_id) await requireChild(familyId, input.child_id);
  const where: any = {
    familyId,
    ...(input.child_id ? { childId: input.child_id } : {}),
    ...(input.question_type_id ? { questionTypeId: input.question_type_id } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.grade ? { grade: input.grade } : {}),
    ...(input.status ? { status: input.status } : { status: { not: "archived" } }),
    ...(input.error_category ? { errorCategory: input.error_category } : {}),
    ...(input.knowledge_point ? { knowledgePoints: { has: input.knowledge_point } } : {}),
    ...(input.query ? { OR: [
      { question: { stem: { contains: input.query, mode: "insensitive" } } },
      { errorReason: { contains: input.query, mode: "insensitive" } },
      { keyLearningPoint: { contains: input.query, mode: "insensitive" } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.wrongQuestionEntry.findMany({
      where,
      include: { child: true, question: true, questionType: true, _count: { select: { attempts: true } } },
      orderBy: [{ status: "asc" }, { lastWrongAt: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.wrongQuestionEntry.count({ where }),
  ]);
  return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}

export async function getWrongQuestion(familyId: string, wrongQuestionId: string) {
  await requireWrongQuestion(familyId, wrongQuestionId);
  return prisma.wrongQuestionEntry.findFirst({
    where: { id: wrongQuestionId, familyId },
    include: {
      child: true,
      question: true,
      questionType: true,
      latestSourceAttempt: true,
      attempts: { include: { question: true, practicePaper: { select: { id: true, title: true } } }, orderBy: { attemptedAt: "desc" }, take: 100 },
      practicePaperItems: { include: { practicePaper: { select: { id: true, title: true, status: true } } }, orderBy: { createdAt: "desc" } },
      remediationTasks: { include: { plan: { select: { id: true, title: true, status: true } } }, orderBy: { sequence: "asc" } },
    },
  });
}

export async function updateWrongQuestion(familyId: string, wrongQuestionId: string, input: any) {
  await requireWrongQuestion(familyId, wrongQuestionId);
  const data = {
    grade: input.grade,
    textbook: input.textbook,
    chapter: input.chapter,
    knowledgePoints: input.knowledge_points === undefined ? undefined : stringArray(input.knowledge_points),
    errorReason: value(input, "error_reason", "errorReason"),
    errorCategory: value(input, "error_category", "errorCategory"),
    workbuddyAnalysis: value(input, "workbuddy_analysis", "workbuddyAnalysis"),
    correctionMethod: value(input, "correction_method", "correctionMethod"),
    keyLearningPoint: value(input, "key_learning_point", "keyLearningPoint"),
    nextReviewAt: value(input, "next_review_at", "nextReviewAt") === undefined ? undefined : dateValue(value(input, "next_review_at", "nextReviewAt")),
  };
  await prisma.wrongQuestionEntry.update({ where: { id: wrongQuestionId }, data: Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined)) });
  return getWrongQuestion(familyId, wrongQuestionId);
}

export async function updateWrongQuestionStatus(familyId: string, wrongQuestionId: string, input: any) {
  const existing = await requireWrongQuestion(familyId, wrongQuestionId);
  if (input.clear_manual_override) {
    await prisma.wrongQuestionEntry.update({
      where: { id: existing.id },
      data: { manualStatus: null, manualReason: null, manualSource: null, status: existing.calculatedStatus },
    });
    return getWrongQuestion(familyId, wrongQuestionId);
  }
  if (!WRONG_QUESTION_STATUSES.includes(input.status)) throw new QuestionBankError("无效的错题状态");
  if (!String(input.reason || "").trim()) throw new QuestionBankError("人工调整错题状态时必须填写原因");
  await prisma.wrongQuestionEntry.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      manualStatus: input.status,
      manualReason: String(input.reason).trim(),
      manualSource: input.source || "parent",
      masteredAt: input.status === "mastered" ? new Date() : existing.masteredAt,
    },
  });
  return getWrongQuestion(familyId, wrongQuestionId);
}

export async function recalculateWrongQuestionMastery(familyId: string, wrongQuestionId: string) {
  const wrong = await requireWrongQuestion(familyId, wrongQuestionId);
  const [attempts, type] = await Promise.all([
    prisma.questionAttempt.findMany({
      where: { familyId, childId: wrong.childId, wrongQuestionId: wrong.id },
      include: { question: { select: { difficulty: true, variationType: true } } },
      orderBy: { attemptedAt: "asc" },
    }),
    requireQuestionType(familyId, wrong.questionTypeId),
  ]);
  const typeCriteria = objectValue(type.masteryCriteria);
  const wrongCriteria = typeCriteria.wrongQuestion || typeCriteria.wrong_question || type.masteryCriteria;
  const result = calculateWrongQuestionMastery(attempts, wrong.questionId, wrongCriteria, wrong.calculatedStatus);
  const status = result.calculatedStatus === "needs_review" ? "needs_review" : (wrong.manualStatus || result.calculatedStatus);
  const [saved, typeMastery] = await Promise.all([
    prisma.wrongQuestionEntry.update({
      where: { id: wrong.id },
      data: {
        status,
        calculatedStatus: result.calculatedStatus,
        masteryScore: result.masteryScore,
        masteryEvidence: result.evidence,
        nextReviewAt: result.nextReviewAt,
        masteredAt: result.calculatedStatus === "mastered" ? (wrong.masteredAt || result.masteredAt) : null,
      },
      include: { child: true, question: true, questionType: true },
    }),
    recalculateMastery(familyId, wrong.childId, wrong.questionTypeId),
  ]);
  return { wrong_question: saved, question_type_mastery: typeMastery };
}

export async function deleteWrongQuestion(familyId: string, wrongQuestionId: string) {
  const item = await requireWrongQuestion(familyId, wrongQuestionId);
  const [attempts, paperItems, tasks] = await Promise.all([
    prisma.questionAttempt.count({ where: { familyId, wrongQuestionId } }),
    prisma.practicePaperQuestion.count({ where: { wrongQuestionId } }),
    prisma.remediationTask.count({ where: { wrongQuestionId } }),
  ]);
  if (attempts + paperItems + tasks > 0) {
    await prisma.wrongQuestionEntry.update({ where: { id: item.id }, data: { status: "archived", manualStatus: "archived", manualReason: "有关联练习证据，按数据完整性规则归档", manualSource: "system" } });
    return { ok: true, wrong_question_id: item.id, archived: true };
  }
  await prisma.wrongQuestionEntry.delete({ where: { id: item.id } });
  return { ok: true, wrong_question_id: item.id, archived: false };
}

export async function getWrongQuestionPracticeContext(familyId: string, input: any) {
  const wrong = await getWrongQuestion(familyId, input.wrong_question_id);
  if (!wrong) throw new QuestionBankError("错题不存在", 404);
  const count = Math.min(20, Math.max(1, Number(input.count || 5)));
  const evidence = objectValue(wrong.masteryEvidence);
  const covered = new Set((wrong.attempts || []).map((attempt: any) => attempt.variationType || attempt.question?.variationType).filter(Boolean));
  const recommended = ["same_structure", "changed_condition", "error_targeted", "multi_step", "transfer", "delayed_review"]
    .filter((item) => !covered.has(item));
  return {
    student: { child_id: wrong.child.id, name: wrong.child.name, grade: wrong.child.grade },
    wrong_question: wrong,
    question_type_rules: {
      ability_goal: wrong.questionType.abilityGoal,
      solution_method: wrong.questionType.solutionMethod,
      standard_steps: wrong.questionType.standardSteps,
      common_errors: wrong.questionType.commonErrors,
      invariants: wrong.questionType.invariants,
      variable_parameters: wrong.questionType.variableParameters,
      difficulty_levels: wrong.questionType.difficultyLevels,
      generation_rule: wrong.questionType.generationRule,
      answer_validation: wrong.questionType.answerValidation,
      rule_version: wrong.questionType.ruleVersion,
    },
    current_mastery: { status: wrong.status, calculated_status: wrong.calculatedStatus, score: wrong.masteryScore, evidence },
    uncovered_variations: recommended,
    request: { count, target_difficulty: input.target_difficulty || (wrong.status === "needs_review" ? "review" : "basic") },
    generation_requirements: {
      purpose: "彻底理解题型，不是简单替换数字或人名",
      progression: ["同结构不同表述", "同知识点不同条件", "易错点专项", "多步骤综合", "新场景迁移", "延迟复习检测"],
      output_schema: {
        stem: "string",
        format: "question format",
        options: "optional JSON",
        answer: "JSON",
        solution: "string",
        scoring_rubric: "optional JSON",
        difficulty: "basic|advanced|transfer|review",
        variation_type: "string",
        source_question_id: wrong.questionId,
        generation_rule_version: wrong.questionType.ruleVersion,
      },
    },
  };
}

async function validatePaperItems(familyId: string, childId: string, questions: any[]) {
  if (!Array.isArray(questions) || questions.length === 0) throw new QuestionBankError("试卷至少包含一道题");
  if (questions.length > 100) throw new QuestionBankError("一份试卷最多包含 100 道题");
  const questionIds = [...new Set(questions.map((item) => item.question_id).filter(Boolean))];
  const wrongIds = [...new Set(questions.map((item) => item.wrong_question_id).filter(Boolean))];
  const [questionRows, wrongRows] = await Promise.all([
    prisma.question.findMany({ where: { familyId, id: { in: questionIds } }, select: { id: true } }),
    prisma.wrongQuestionEntry.findMany({ where: { familyId, childId, id: { in: wrongIds } }, select: { id: true, questionId: true } }),
  ]);
  if (questionRows.length !== questionIds.length) throw new QuestionBankError("试卷包含不存在或不属于当前家庭的题目", 404);
  if (wrongRows.length !== wrongIds.length) throw new QuestionBankError("试卷包含不存在、学生不一致或不属于当前家庭的错题", 404);
  const wrongMap = new Map(wrongRows.map((item) => [item.id, item]));
  questions.forEach((item, index) => {
    if (!item.question_id) throw new QuestionBankError(`试卷第 ${index + 1} 题缺少 question_id`);
    if (item.wrong_question_id && wrongMap.get(item.wrong_question_id)?.questionId !== item.question_id && !item.allow_variant) {
      throw new QuestionBankError(`试卷第 ${index + 1} 题与关联错题不一致；变式题请设置 allow_variant=true`);
    }
  });
}

function paperData(input: any) {
  return Object.fromEntries(Object.entries({
    title: input.title,
    subject: input.subject,
    grade: input.grade,
    objective: input.objective,
    diagnosisSummary: value(input, "diagnosis_summary", "diagnosisSummary"),
    difficultyDistribution: value(input, "difficulty_distribution", "difficultyDistribution"),
    estimatedMinutes: value(input, "estimated_minutes", "estimatedMinutes") === undefined ? undefined : Number(value(input, "estimated_minutes", "estimatedMinutes")),
    totalScore: value(input, "total_score", "totalScore") === undefined ? undefined : Number(value(input, "total_score", "totalScore")),
    status: input.status,
    source: input.source,
    generatedAt: value(input, "generated_at", "generatedAt") === undefined ? undefined : dateValue(value(input, "generated_at", "generatedAt")),
    completedAt: value(input, "completed_at", "completedAt") === undefined ? undefined : dateValue(value(input, "completed_at", "completedAt")),
    resultSummary: value(input, "result_summary", "resultSummary"),
  }).filter(([, item]) => item !== undefined));
}

function paperQuestionData(item: any, index: number) {
  return {
    questionId: item.question_id,
    wrongQuestionId: item.wrong_question_id,
    section: item.section,
    sequence: item.sequence === undefined ? index + 1 : Number(item.sequence),
    score: item.score === undefined ? undefined : Number(item.score),
    purpose: item.purpose,
    targetErrorCategory: item.target_error_category,
  };
}

export async function createPracticePaper(familyId: string, input: any) {
  const child = await requireChild(familyId, input.child_id);
  if (!String(input.title || "").trim()) throw new QuestionBankError("试卷标题不能为空");
  await validatePaperItems(familyId, child.id, input.questions);
  const paper = await prisma.practicePaper.create({
    data: {
      familyId,
      childId: child.id,
      ...paperData(input),
      title: String(input.title).trim(),
      status: input.status || "ready",
      source: input.source || "workbuddy",
      totalScore: value(input, "total_score", "totalScore") === undefined
        ? input.questions.reduce((sum: number, item: any) => sum + Number(item.score || 0), 0) || undefined
        : Number(value(input, "total_score", "totalScore")),
      questions: { create: input.questions.map(paperQuestionData) },
    },
  });
  return getPracticePaper(familyId, paper.id);
}

export async function listPracticePapers(familyId: string, input: any = {}) {
  const { limit, offset } = pageValues(input);
  if (input.child_id) await requireChild(familyId, input.child_id);
  const where: any = {
    familyId,
    ...(input.child_id ? { childId: input.child_id } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.status ? { status: input.status } : { status: { not: "archived" } }),
    ...(input.query ? { title: { contains: input.query, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.practicePaper.findMany({ where, include: { child: true, _count: { select: { questions: true, attempts: true } } }, orderBy: { generatedAt: "desc" }, take: limit, skip: offset }),
    prisma.practicePaper.count({ where }),
  ]);
  return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}

export async function getPracticePaper(familyId: string, practicePaperId: string) {
  await requirePracticePaper(familyId, practicePaperId);
  return prisma.practicePaper.findFirst({
    where: { id: practicePaperId, familyId },
    include: {
      child: true,
      questions: { include: { question: { include: { questionType: true } }, wrongQuestion: true }, orderBy: { sequence: "asc" } },
      attempts: { include: { question: true }, orderBy: { attemptedAt: "desc" } },
    },
  });
}

export async function updatePracticePaper(familyId: string, practicePaperId: string, input: any) {
  const paper = await requirePracticePaper(familyId, practicePaperId);
  if (input.status && !PAPER_STATUSES.includes(input.status)) throw new QuestionBankError("无效的试卷状态");
  if (input.questions) await validatePaperItems(familyId, paper.childId, input.questions);
  await prisma.$transaction(async (tx) => {
    await tx.practicePaper.update({ where: { id: paper.id }, data: paperData(input) });
    if (input.questions) {
      await tx.practicePaperQuestion.deleteMany({ where: { practicePaperId: paper.id } });
      await tx.practicePaperQuestion.createMany({ data: input.questions.map((item: any, index: number) => ({ practicePaperId: paper.id, ...paperQuestionData(item, index) })) });
    }
  });
  return getPracticePaper(familyId, paper.id);
}

export async function deletePracticePaper(familyId: string, practicePaperId: string) {
  const paper = await requirePracticePaper(familyId, practicePaperId);
  const attemptCount = await prisma.questionAttempt.count({ where: { familyId, practicePaperId: paper.id } });
  if (attemptCount > 0) {
    await prisma.practicePaper.update({ where: { id: paper.id }, data: { status: "archived" } });
    return { ok: true, practice_paper_id: paper.id, archived: true };
  }
  await prisma.practicePaper.delete({ where: { id: paper.id } });
  return { ok: true, practice_paper_id: paper.id, archived: false };
}

async function validateRemediationTasks(familyId: string, childId: string, tasks: any[]) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new QuestionBankError("教学规划至少包含一个任务");
  if (tasks.length > 100) throw new QuestionBankError("一个教学规划最多包含 100 个任务");
  const wrongIds = [...new Set(tasks.map((item) => item.wrong_question_id).filter(Boolean))];
  const typeIds = [...new Set(tasks.map((item) => item.question_type_id).filter(Boolean))];
  const [wrongRows, typeRows] = await Promise.all([
    prisma.wrongQuestionEntry.findMany({ where: { familyId, childId, id: { in: wrongIds } }, select: { id: true } }),
    prisma.questionType.findMany({ where: { familyId, id: { in: typeIds } }, select: { id: true } }),
  ]);
  if (wrongRows.length !== wrongIds.length) throw new QuestionBankError("教学任务包含不存在、学生不一致或不属于当前家庭的错题", 404);
  if (typeRows.length !== typeIds.length) throw new QuestionBankError("教学任务包含不存在或不属于当前家庭的题型", 404);
  tasks.forEach((task, index) => {
    if (!String(task.title || "").trim() || !String(task.task_type || "").trim()) throw new QuestionBankError(`第 ${index + 1} 个任务缺少标题或任务类型`);
  });
}

function planData(input: any) {
  return Object.fromEntries(Object.entries({
    title: input.title,
    subject: input.subject,
    diagnosis: input.diagnosis,
    objectives: input.objectives,
    strategy: input.strategy,
    startDate: value(input, "start_date", "startDate") === undefined ? undefined : dateValue(value(input, "start_date", "startDate")),
    endDate: value(input, "end_date", "endDate") === undefined ? undefined : dateValue(value(input, "end_date", "endDate")),
    status: input.status,
    source: input.source,
  }).filter(([, item]) => item !== undefined));
}

function taskData(task: any, index: number) {
  return {
    wrongQuestionId: task.wrong_question_id,
    questionTypeId: task.question_type_id,
    title: String(task.title).trim(),
    description: task.description,
    taskType: task.task_type,
    sequence: task.sequence === undefined ? index + 1 : Number(task.sequence),
    estimatedMinutes: task.estimated_minutes === undefined ? undefined : Number(task.estimated_minutes),
    dueAt: task.due_at === undefined ? undefined : dateValue(task.due_at),
    status: task.status || "pending",
    completionEvidence: task.completion_evidence,
    completedAt: task.completed_at === undefined ? undefined : dateValue(task.completed_at),
  };
}

export async function saveRemediationPlan(familyId: string, input: any) {
  const child = await requireChild(familyId, input.child_id);
  if (!String(input.title || "").trim()) throw new QuestionBankError("教学规划标题不能为空");
  await validateRemediationTasks(familyId, child.id, input.tasks);
  const plan = await prisma.remediationPlan.create({
    data: {
      familyId,
      childId: child.id,
      ...planData(input),
      title: String(input.title).trim(),
      status: input.status || "active",
      source: input.source || "workbuddy",
      tasks: { create: input.tasks.map(taskData) },
    },
  });
  return getRemediationPlan(familyId, plan.id);
}

export async function listRemediationPlans(familyId: string, input: any = {}) {
  const { limit, offset } = pageValues(input);
  if (input.child_id) await requireChild(familyId, input.child_id);
  const where: any = {
    familyId,
    ...(input.child_id ? { childId: input.child_id } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.status ? { status: input.status } : { status: { not: "archived" } }),
    ...(input.query ? { title: { contains: input.query, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.remediationPlan.findMany({ where, include: { child: true, _count: { select: { tasks: true } } }, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.remediationPlan.count({ where }),
  ]);
  return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}

export async function getRemediationPlan(familyId: string, remediationPlanId: string) {
  await requireRemediationPlan(familyId, remediationPlanId);
  return prisma.remediationPlan.findFirst({
    where: { id: remediationPlanId, familyId },
    include: { child: true, tasks: { include: { wrongQuestion: { include: { question: true } }, questionType: true }, orderBy: { sequence: "asc" } } },
  });
}

export async function updateRemediationPlan(familyId: string, remediationPlanId: string, input: any) {
  const plan = await requireRemediationPlan(familyId, remediationPlanId);
  if (input.status && !PLAN_STATUSES.includes(input.status)) throw new QuestionBankError("无效的教学规划状态");
  if (input.tasks) await validateRemediationTasks(familyId, plan.childId, input.tasks);
  if (input.tasks) {
    const completedTasks = await prisma.remediationTask.count({ where: { planId: plan.id, status: "completed" } });
    if (completedTasks > 0) throw new QuestionBankError("教学规划已有完成证据，不能整体替换任务；请只更新规划信息或任务状态", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.remediationPlan.update({ where: { id: plan.id }, data: planData(input) });
    if (input.tasks) {
      await tx.remediationTask.deleteMany({ where: { planId: plan.id } });
      await tx.remediationTask.createMany({ data: input.tasks.map((task: any, index: number) => ({ planId: plan.id, ...taskData(task, index) })) });
    }
  });
  return getRemediationPlan(familyId, plan.id);
}

export async function updateRemediationTaskStatus(familyId: string, remediationPlanId: string, taskId: string, input: any) {
  await requireRemediationPlan(familyId, remediationPlanId);
  if (!TASK_STATUSES.includes(input.status)) throw new QuestionBankError("无效的任务状态");
  const task = await prisma.remediationTask.findFirst({ where: { id: taskId, planId: remediationPlanId, plan: { familyId } } });
  if (!task) throw new QuestionBankError("教学任务不存在或不属于当前家庭", 404);
  return prisma.remediationTask.update({
    where: { id: task.id },
    data: {
      status: input.status,
      completionEvidence: value(input, "completion_evidence", "completionEvidence"),
      completedAt: input.status === "completed" ? (dateValue(value(input, "completed_at", "completedAt")) || new Date()) : null,
    },
  });
}

export async function deleteRemediationPlan(familyId: string, remediationPlanId: string) {
  const plan = await requireRemediationPlan(familyId, remediationPlanId);
  const completedTaskCount = await prisma.remediationTask.count({ where: { planId: plan.id, status: "completed" } });
  if (completedTaskCount > 0) {
    await prisma.remediationPlan.update({ where: { id: plan.id }, data: { status: "archived" } });
    return { ok: true, remediation_plan_id: plan.id, archived: true };
  }
  await prisma.remediationPlan.delete({ where: { id: plan.id } });
  return { ok: true, remediation_plan_id: plan.id, archived: false };
}

export async function recordQuestionAttemptWithWrongBook(familyId: string, input: any) {
  if (input.wrong_question_id) {
    const wrong = await requireWrongQuestion(familyId, input.wrong_question_id);
    if (wrong.childId !== input.child_id || wrong.questionTypeId !== input.question_type_id && input.question_type_id) {
      throw new QuestionBankError("错题与学生或题型不一致");
    }
  }
  if (input.practice_paper_id) {
    const paper = await requirePracticePaper(familyId, input.practice_paper_id);
    if (paper.childId !== input.child_id) throw new QuestionBankError("试卷与学生不一致");
    const inPaper = await prisma.practicePaperQuestion.count({ where: { practicePaperId: paper.id, questionId: input.question_id } });
    if (!inPaper) throw new QuestionBankError("该题目不在指定试卷中");
  }
  const result = await recordQuestionAttempt(familyId, input);
  let wrongQuestionId = input.wrong_question_id;
  if (input.is_correct === false && (input.save_to_wrong_book || input.wrong_question_id)) {
    const wrong = await saveWrongQuestion(familyId, {
      ...input,
      source_attempt_id: result.attempt.id,
      wrong_answer: input.student_answer,
      workbuddy_analysis: input.evaluation,
    });
    wrongQuestionId = wrong?.id;
  }
  const wrongMastery = wrongQuestionId ? await recalculateWrongQuestionMastery(familyId, wrongQuestionId) : null;
  return { ...result, wrong_question_mastery: wrongMastery };
}
