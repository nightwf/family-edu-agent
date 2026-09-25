import { prisma } from "../prisma.js";
import { normalizeMasteryCriteria } from "../question-bank.js";
/**
 * 学习决策层：只做确定性计算，不调用大模型。
 *
 * 职责边界：
 * - 禾芽：从真实作答与错题里算出触发信号、排学习优先级、限定验证规则；
 * - WorkBuddy：读这些信号去制定目标与教学方案；
 * - 家长：确认目标与计划。
 */
export const SIGNAL_TYPES = [
    "PREREQUISITE_GAP",
    "REPEATED_ERROR",
    "REVIEW_DUE",
    "LOW_MASTERY",
    "VARIATION_GAP",
];
/** 信号类型的基础优先级，数字越大越先处理：先补地基，再灭重复错误，再复测。 */
export const SIGNAL_BASE_PRIORITY = {
    PREREQUISITE_GAP: 100,
    REPEATED_ERROR: 90,
    REVIEW_DUE: 80,
    LOW_MASTERY: 70,
    VARIATION_GAP: 60,
};
export const SIGNAL_LABELS = {
    PREREQUISITE_GAP: "前置知识缺口",
    REPEATED_ERROR: "重复出错",
    REVIEW_DUE: "复测到期",
    LOW_MASTERY: "掌握度偏低",
    VARIATION_GAP: "变式覆盖不足",
};
const REPEATED_ERROR_WINDOW_DAYS = 14;
const REPEATED_ERROR_MIN_FAILURES = 2;
const LOW_MASTERY_THRESHOLD = 60;
const GOAL_RELEVANCE_BONUS = 15;
export const PLANNING_SIGNAL_THRESHOLD = 70;
export class LearningEngineError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}
function attemptPassed(attempt) {
    return attempt.isCorrect ?? (attempt.score !== null && attempt.score >= 60);
}
function daysBetween(later, earlier) {
    return (later.getTime() - earlier.getTime()) / 86_400_000;
}
/**
 * 把一个知识节点下的全部作答聚合成掌握状态。
 * 组件权重与题库题型掌握度保持一致，避免同一份证据在不同页面给出不同结论。
 */
export function aggregateKnowledgeScore(attempts, criteriaInput, previousStatus = null, now = new Date()) {
    const criteria = normalizeMasteryCriteria(criteriaInput);
    const ordered = [...attempts].sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
    const totalAttempts = ordered.length;
    const correctAttempts = ordered.filter(attemptPassed).length;
    const independentAttempts = ordered.filter((item) => !item.usedHint);
    const independentCorrect = independentAttempts.filter(attemptPassed).length;
    const correctRate = totalAttempts ? correctAttempts / totalAttempts : 0;
    const variationKeys = new Set(ordered.map((item) => item.variationType || item.difficulty || "original"));
    const variationCount = variationKeys.size;
    const transferAttempts = ordered.filter((item) => item.variationType === "transfer" || item.difficulty === "transfer");
    const transferCorrect = transferAttempts.filter(attemptPassed).length;
    const transferRate = transferAttempts.length ? transferCorrect / transferAttempts.length : 0;
    const firstIndependentCorrect = ordered.find((item) => !item.usedHint && attemptPassed(item));
    const delayedReviewPassed = Boolean(firstIndependentCorrect
        && ordered.some((item) => (item !== firstIndependentCorrect
            && !item.usedHint
            && attemptPassed(item)
            && daysBetween(item.attemptedAt, firstIndependentCorrect.attemptedAt) >= criteria.delayedHours / 24)));
    const components = {
        accuracy: correctRate * 35,
        independence: (totalAttempts ? independentCorrect / totalAttempts : 0) * 20,
        variationCoverage: Math.min(1, variationCount / criteria.minVariations) * 20,
        transfer: transferRate * 15,
        retention: delayedReviewPassed ? 10 : 0,
    };
    const score = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0) * 10) / 10;
    const mastered = score >= criteria.minScore
        && totalAttempts >= criteria.minAttempts
        && variationCount >= criteria.minVariations
        && (!criteria.requireTransfer || transferCorrect > 0)
        && (!criteria.requireDelayedReview || delayedReviewPassed);
    let status = "UNASSESSED";
    if (totalAttempts > 0)
        status = "LEARNING";
    if (totalAttempts >= 3 && score >= LOW_MASTERY_THRESHOLD)
        status = "PARTIAL";
    if (mastered)
        status = "MASTERED";
    if (previousStatus === "MASTERED" && !mastered && totalAttempts > 0)
        status = "NEEDS_REVIEW";
    const lastPracticedAt = ordered.at(-1)?.attemptedAt || null;
    const nextReviewDays = status === "MASTERED" ? 7 : status === "PARTIAL" ? 3 : 1;
    return {
        status,
        score,
        totalAttempts,
        correctRate: Math.round(correctRate * 1000) / 1000,
        independentAttempts: independentAttempts.length,
        variationCount,
        delayedReviewPassed,
        lastPracticedAt,
        nextReviewAt: lastPracticedAt ? new Date(lastPracticedAt.getTime() + nextReviewDays * 86_400_000) : null,
        evidence: {
            criteria,
            components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 10) / 10])),
            variationTypes: [...variationKeys],
            transferAttempts: transferAttempts.length,
            transferCorrect,
            evaluatedAt: now.toISOString(),
        },
    };
}
async function requireQuestionType(familyId, questionTypeId) {
    const questionType = await prisma.questionType.findFirst({ where: { id: questionTypeId, familyId } });
    if (!questionType)
        throw new LearningEngineError("题型不存在或不属于当前家庭", 404);
    return questionType;
}
async function requireKnowledgeNodes(familyId, nodeIds) {
    const nodes = await prisma.knowledgeNode.findMany({ where: { familyId, id: { in: nodeIds } } });
    if (nodes.length !== nodeIds.length)
        throw new LearningEngineError("知识节点不存在或不属于当前家庭", 404);
    return nodes;
}
function linkValues(links) {
    const seen = new Set();
    const cleaned = links
        .map((link) => ({
        knowledgeNodeId: String(link.knowledge_node_id || "").trim(),
        role: link.role || "primary",
        weight: Number.isFinite(Number(link.weight)) ? Number(link.weight) : 1,
    }))
        .filter((link) => link.knowledgeNodeId && !seen.has(link.knowledgeNodeId) && seen.add(link.knowledgeNodeId));
    if (!cleaned.length)
        throw new LearningEngineError("至少需要一个有效的 knowledge_node_id");
    return cleaned;
}
/** 题型关联知识节点，重复调用按节点覆盖，不产生重复关联。 */
export async function linkQuestionTypeKnowledgeNodes(familyId, questionTypeId, links) {
    await requireQuestionType(familyId, questionTypeId);
    const cleaned = linkValues(links);
    await requireKnowledgeNodes(familyId, cleaned.map((item) => item.knowledgeNodeId));
    for (const link of cleaned) {
        await prisma.questionTypeKnowledgeNode.upsert({
            where: { questionTypeId_knowledgeNodeId: { questionTypeId, knowledgeNodeId: link.knowledgeNodeId } },
            update: { role: link.role, weight: link.weight },
            create: { familyId, questionTypeId, ...link },
        });
    }
    return listQuestionTypeKnowledgeNodes(familyId, questionTypeId);
}
export async function listQuestionTypeKnowledgeNodes(familyId, questionTypeId) {
    const items = await prisma.questionTypeKnowledgeNode.findMany({
        where: { familyId, questionTypeId },
        include: { knowledgeNode: true },
        orderBy: { createdAt: "asc" },
    });
    return items.map((item) => ({
        knowledge_node_id: item.knowledgeNodeId,
        title: item.knowledgeNode?.title,
        subject: item.knowledgeNode?.subject,
        role: item.role,
        weight: item.weight,
    }));
}
export async function unlinkQuestionTypeKnowledgeNode(familyId, questionTypeId, knowledgeNodeId) {
    await requireQuestionType(familyId, questionTypeId);
    await prisma.questionTypeKnowledgeNode.deleteMany({ where: { familyId, questionTypeId, knowledgeNodeId } });
    return { ok: true, question_type_id: questionTypeId, knowledge_node_id: knowledgeNodeId };
}
/** 单题可以覆盖题型默认关联，用于一道题考察多个知识点。 */
export async function linkQuestionKnowledgeNodes(familyId, questionId, links) {
    const question = await prisma.question.findFirst({ where: { id: questionId, familyId } });
    if (!question)
        throw new LearningEngineError("题目不存在或不属于当前家庭", 404);
    const cleaned = linkValues(links);
    await requireKnowledgeNodes(familyId, cleaned.map((item) => item.knowledgeNodeId));
    for (const link of cleaned) {
        await prisma.questionKnowledgeNode.upsert({
            where: { questionId_knowledgeNodeId: { questionId, knowledgeNodeId: link.knowledgeNodeId } },
            update: { role: link.role, weight: link.weight },
            create: { familyId, questionId, ...link },
        });
    }
    return listQuestionKnowledgeNodes(familyId, questionId);
}
export async function listQuestionKnowledgeNodes(familyId, questionId) {
    const items = await prisma.questionKnowledgeNode.findMany({
        where: { familyId, questionId },
        include: { knowledgeNode: true },
        orderBy: { createdAt: "asc" },
    });
    return items.map((item) => ({
        knowledge_node_id: item.knowledgeNodeId,
        title: item.knowledgeNode?.title,
        role: item.role,
        weight: item.weight,
    }));
}
/** 题目自身的关联优先，其次使用题型默认关联。 */
export async function resolveKnowledgeNodeIds(familyId, questionId, questionTypeId) {
    const questionLinks = await prisma.questionKnowledgeNode.findMany({ where: { familyId, questionId } });
    if (questionLinks.length)
        return questionLinks.map((item) => item.knowledgeNodeId);
    const typeLinks = await prisma.questionTypeKnowledgeNode.findMany({ where: { familyId, questionTypeId } });
    return typeLinks.map((item) => item.knowledgeNodeId);
}
/**
 * 作答后回写知识点掌握状态。
 * 人工修正确立过的状态不会被自动计算覆盖，自动计算值保存在证据里便于对比。
 */
export async function refreshKnowledgeStateFromAttempt(familyId, childId, questionId, questionTypeId, now = new Date()) {
    const nodeIds = await resolveKnowledgeNodeIds(familyId, questionId, questionTypeId);
    if (!nodeIds.length)
        return { updated: [] };
    const [questionType, typeLinks, questionLinks] = await Promise.all([
        prisma.questionType.findFirst({ where: { id: questionTypeId, familyId } }),
        prisma.questionTypeKnowledgeNode.findMany({ where: { familyId, knowledgeNodeId: { in: nodeIds } } }),
        prisma.questionKnowledgeNode.findMany({ where: { familyId, knowledgeNodeId: { in: nodeIds } } }),
    ]);
    const updated = [];
    for (const knowledgeNodeId of nodeIds) {
        const relatedTypeIds = new Set(typeLinks.filter((item) => item.knowledgeNodeId === knowledgeNodeId).map((item) => item.questionTypeId));
        relatedTypeIds.add(questionTypeId);
        const relatedQuestionIds = questionLinks
            .filter((item) => item.knowledgeNodeId === knowledgeNodeId)
            .map((item) => item.questionId);
        const attempts = await prisma.questionAttempt.findMany({
            where: {
                familyId,
                childId,
                OR: [
                    { questionTypeId: { in: [...relatedTypeIds] } },
                    ...(relatedQuestionIds.length ? [{ questionId: { in: relatedQuestionIds } }] : []),
                ],
            },
            include: { question: { select: { variationType: true, difficulty: true } } },
            orderBy: { attemptedAt: "asc" },
        });
        const existing = await prisma.childKnowledgeState.findUnique({
            where: { childId_knowledgeNodeId: { childId, knowledgeNodeId } },
        });
        // 人工修正存在时，判断“是否退步”要和上一次自动计算结果比，而不是拿人工状态比。
        const previousCalculated = existing
            ? existing.manualStatus
                ? existing.evidence?.calculated_status ?? null
                : existing.status
            : null;
        const result = aggregateKnowledgeScore(attempts.map((item) => ({
            isCorrect: item.isCorrect,
            score: item.score,
            usedHint: item.usedHint,
            attemptedAt: item.attemptedAt,
            variationType: item.variationType ?? item.question?.variationType ?? null,
            difficulty: item.question?.difficulty || "basic",
        })), questionType?.masteryCriteria, previousCalculated, now);
        const status = existing?.manualStatus || result.status;
        const evidence = {
            ...result.evidence,
            calculated_status: result.status,
            manual_status: existing?.manualStatus ?? null,
        };
        const saved = await prisma.childKnowledgeState.upsert({
            where: { childId_knowledgeNodeId: { childId, knowledgeNodeId } },
            update: {
                status: status,
                score: result.score,
                evidence: evidence,
                lastPracticedAt: result.lastPracticedAt,
                nextReviewAt: result.nextReviewAt,
            },
            create: {
                familyId,
                childId,
                knowledgeNodeId,
                status: status,
                score: result.score,
                evidence: evidence,
                lastPracticedAt: result.lastPracticedAt,
                nextReviewAt: result.nextReviewAt,
            },
        });
        updated.push({ knowledge_node_id: knowledgeNodeId, status: saved.status, score: saved.score });
    }
    return { updated };
}
/**
 * 从真实数据里识别学习触发信号。全部来自作答、错题和掌握状态，
 * 不做情绪或心理推断。
 */
export async function detectLearningSignals(familyId, childId, now = new Date()) {
    const windowStart = new Date(now.getTime() - REPEATED_ERROR_WINDOW_DAYS * 86_400_000);
    const [masteries, wrongs, knowledgeStates, relations] = await Promise.all([
        prisma.studentQuestionTypeMastery.findMany({ where: { familyId, childId }, include: { questionType: true } }),
        prisma.wrongQuestionEntry.findMany({
            where: { familyId, childId, status: { notIn: ["mastered", "archived"] } },
            include: { questionType: true },
            orderBy: { lastWrongAt: "desc" },
        }),
        prisma.childKnowledgeState.findMany({ where: { familyId, childId }, include: { knowledgeNode: true } }),
        prisma.knowledgeRelation.findMany({ where: { familyId, relationType: "PREREQUISITE_OF" } }),
    ]);
    const signals = [];
    const stateByNode = new Map(knowledgeStates.map((item) => [item.knowledgeNodeId, item]));
    for (const mastery of masteries) {
        const typeName = mastery.questionType?.name || "未知题型";
        const criteria = normalizeMasteryCriteria(mastery.questionType?.masteryCriteria);
        const subject = mastery.questionType?.subject || null;
        if (mastery.nextReviewAt && mastery.nextReviewAt <= now && mastery.status !== "unassessed") {
            signals.push({
                type: "REVIEW_DUE",
                dedupeKey: `review_due:type:${mastery.questionTypeId}`,
                severity: 2,
                reason: `${typeName}已到复测时间，需要确认是否还记得。`,
                knowledgeNodeId: null,
                questionTypeId: mastery.questionTypeId,
                wrongQuestionId: null,
                evidence: {
                    subject,
                    mastery_status: mastery.status,
                    mastery_score: mastery.masteryScore,
                    next_review_at: mastery.nextReviewAt,
                },
            });
        }
        if (mastery.totalAttempts >= 3 && mastery.masteryScore < LOW_MASTERY_THRESHOLD) {
            signals.push({
                type: "LOW_MASTERY",
                dedupeKey: `low_mastery:type:${mastery.questionTypeId}`,
                severity: 3,
                reason: `${typeName}练习 ${mastery.totalAttempts} 次后掌握分仍只有 ${Math.round(mastery.masteryScore)}，说明还停留在表面理解。`,
                knowledgeNodeId: null,
                questionTypeId: mastery.questionTypeId,
                wrongQuestionId: null,
                evidence: {
                    subject,
                    mastery_score: mastery.masteryScore,
                    total_attempts: mastery.totalAttempts,
                    correct_rate: mastery.correctRate,
                },
            });
        }
        if (mastery.totalAttempts >= 3
            && mastery.status !== "mastered"
            && mastery.variationCount < criteria.minVariations) {
            signals.push({
                type: "VARIATION_GAP",
                dedupeKey: `variation_gap:type:${mastery.questionTypeId}`,
                severity: 1,
                reason: `${typeName}目前只覆盖 ${mastery.variationCount} 种变式，少于要求的 ${criteria.minVariations} 种。`,
                knowledgeNodeId: null,
                questionTypeId: mastery.questionTypeId,
                wrongQuestionId: null,
                evidence: {
                    subject,
                    variation_count: mastery.variationCount,
                    required_variations: criteria.minVariations,
                },
            });
        }
    }
    for (const wrong of wrongs) {
        const typeName = wrong.questionType?.name || wrong.questionTypeId;
        const subject = wrong.subject || null;
        if (wrong.nextReviewAt && wrong.nextReviewAt <= now) {
            signals.push({
                type: "REVIEW_DUE",
                dedupeKey: `review_due:wrong:${wrong.id}`,
                severity: 2,
                reason: `错题「${typeName}」已到复订后的复测时间。`,
                knowledgeNodeId: null,
                questionTypeId: wrong.questionTypeId,
                wrongQuestionId: wrong.id,
                evidence: { subject, next_review_at: wrong.nextReviewAt, mistake_count: wrong.mistakeCount },
            });
        }
        const recentRepeat = wrong.mistakeCount >= REPEATED_ERROR_MIN_FAILURES && wrong.lastWrongAt >= windowStart;
        if (recentRepeat) {
            signals.push({
                type: "REPEATED_ERROR",
                dedupeKey: `repeated_error:wrong:${wrong.id}`,
                severity: wrong.mistakeCount >= 3 ? 3 : 2,
                reason: `${typeName}在 ${REPEATED_ERROR_WINDOW_DAYS} 天内重复出错 ${wrong.mistakeCount} 次${wrong.errorReason ? `，原因：${wrong.errorReason}` : ""}。`,
                knowledgeNodeId: null,
                questionTypeId: wrong.questionTypeId,
                wrongQuestionId: wrong.id,
                evidence: {
                    subject,
                    mistake_count: wrong.mistakeCount,
                    last_wrong_at: wrong.lastWrongAt,
                    error_reason: wrong.errorReason,
                },
            });
        }
    }
    for (const relation of relations) {
        const prerequisite = stateByNode.get(relation.sourceNodeId);
        const dependent = stateByNode.get(relation.targetNodeId);
        if (!dependent)
            continue;
        const dependentActive = ["LEARNING", "PARTIAL", "NEEDS_REVIEW"].includes(dependent.status);
        if (!dependentActive)
            continue;
        const prerequisiteSolid = prerequisite && prerequisite.status === "MASTERED" && prerequisite.score >= 80;
        if (prerequisiteSolid)
            continue;
        signals.push({
            type: "PREREQUISITE_GAP",
            dedupeKey: `prerequisite_gap:${relation.sourceNodeId}:${relation.targetNodeId}`,
            severity: relation.strength === "hard" ? 3 : 2,
            reason: `正在学的「${dependent.knowledgeNode?.title || "知识点"}」依赖「${prerequisite?.knowledgeNode?.title || relation.sourceNodeId}」，但后者还没有达到掌握标准。`,
            knowledgeNodeId: relation.sourceNodeId,
            questionTypeId: null,
            wrongQuestionId: null,
            evidence: {
                dependent_node_id: relation.targetNodeId,
                dependent_node_title: dependent.knowledgeNode?.title,
                prerequisite_status: prerequisite?.status || "UNASSESSED",
                prerequisite_score: prerequisite?.score ?? null,
                strength: relation.strength,
                relation_reason: relation.reason,
            },
        });
    }
    return signals;
}
/**
 * 持久化信号：新信号写入，已消失的信号标记为 resolved，
 * 这样首页只显示当前真正需要注意的问题。
 */
export async function syncLearningSignals(familyId, childId, now = new Date()) {
    const drafts = await detectLearningSignals(familyId, childId, now);
    const activeKeys = new Set(drafts.map((item) => item.dedupeKey));
    for (const draft of drafts) {
        await prisma.learningSignal.upsert({
            where: { childId_dedupeKey: { childId, dedupeKey: draft.dedupeKey } },
            update: {
                type: draft.type,
                severity: draft.severity,
                reason: draft.reason,
                evidence: draft.evidence,
                knowledgeNodeId: draft.knowledgeNodeId,
                questionTypeId: draft.questionTypeId,
                wrongQuestionId: draft.wrongQuestionId,
                status: "active",
                resolvedAt: null,
            },
            create: {
                familyId,
                childId,
                type: draft.type,
                severity: draft.severity,
                dedupeKey: draft.dedupeKey,
                reason: draft.reason,
                evidence: draft.evidence,
                knowledgeNodeId: draft.knowledgeNodeId,
                questionTypeId: draft.questionTypeId,
                wrongQuestionId: draft.wrongQuestionId,
            },
        });
    }
    const openSignals = await prisma.learningSignal.findMany({ where: { familyId, childId, status: "active" } });
    for (const signal of openSignals) {
        if (activeKeys.has(signal.dedupeKey))
            continue;
        await prisma.learningSignal.update({
            where: { id: signal.id },
            data: { status: "resolved", resolvedAt: now },
        });
    }
    return prisma.learningSignal.findMany({
        where: { familyId, childId, status: "active" },
        orderBy: [{ severity: "desc" }, { detectedAt: "desc" }],
    });
}
/**
 * 人工把信号标记为已解决或已忽略。
 * 忽略只影响当前这条信号；下次数据仍然触发时会被重新写入。
 */
export async function resolveLearningSignal(familyId, signalId, input = {}, now = new Date()) {
    const signal = await prisma.learningSignal.findFirst({ where: { id: signalId, familyId } });
    if (!signal)
        throw new LearningEngineError("信号不存在或不属于当前家庭", 404);
    const evidence = {
        ...(signal.evidence || {}),
        resolution_note: input.note ?? null,
        resolved_by: "parent",
    };
    return prisma.learningSignal.update({
        where: { id: signalId },
        data: {
            status: input.status || "dismissed",
            resolvedAt: now,
            evidence: evidence,
        },
    });
}
/**
 * 排学习优先级。规则公开可解释：类型基础分 + 严重度 + 与当前目标的相关性 + 新鲜度。
 */
export function rankLearningPriorities(signals, options = {}) {
    const now = options.now || new Date();
    const goalText = String(options.goalText || "");
    return signals
        .map((signal) => {
        const base = SIGNAL_BASE_PRIORITY[signal.type] ?? 50;
        const severityScore = Math.max(0, Math.min(3, Number(signal.severity) || 0)) * 5;
        const focus = String(signal.subject || signal.label || "").trim();
        const goalBonus = goalText && focus && goalText.includes(focus) ? GOAL_RELEVANCE_BONUS : 0;
        const ageDays = signal.detectedAt ? Math.max(0, daysBetween(now, new Date(signal.detectedAt))) : REPEATED_ERROR_WINDOW_DAYS;
        const freshness = Math.round(Math.max(0, 10 - ageDays));
        return {
            ...signal,
            label: signal.label || SIGNAL_LABELS[signal.type] || signal.type,
            priorityScore: base + severityScore + goalBonus + freshness,
            priorityBreakdown: { base, severity: severityScore, goal_relevance: goalBonus, freshness },
        };
    })
        .sort((a, b) => b.priorityScore - a.priorityScore);
}
/**
 * 对外统一出口：同步信号 → 排序 → 拼成可直接给 WorkBuddy 或首页使用的学习优先级。
 */
export async function getLearningPriorities(familyId, childId, options = {}) {
    const now = options.now || new Date();
    const [child, activeGoal, signals] = await Promise.all([
        prisma.child.findFirst({ where: { id: childId, familyId } }),
        prisma.stageGoal.findFirst({
            where: { familyId, childId, status: { in: ["CONFIRMED", "ACTIVE"] } },
            orderBy: { endDate: "desc" },
        }),
        syncLearningSignals(familyId, childId, now),
    ]);
    if (!child)
        throw new LearningEngineError("学生不存在或不属于当前家庭", 404);
    const [questionTypes, knowledgeNodes] = await Promise.all([
        prisma.questionType.findMany({ where: { familyId } }),
        prisma.knowledgeNode.findMany({ where: { familyId } }),
    ]);
    const typeById = new Map(questionTypes.map((item) => [item.id, item]));
    const nodeById = new Map(knowledgeNodes.map((item) => [item.id, item]));
    const goalText = activeGoal ? `${activeGoal.title} ${activeGoal.objective}` : "";
    const ranked = rankLearningPriorities(signals.map((signal) => {
        const questionType = signal.questionTypeId ? typeById.get(signal.questionTypeId) : null;
        const node = signal.knowledgeNodeId ? nodeById.get(signal.knowledgeNodeId) : null;
        return {
            id: signal.id,
            type: signal.type,
            severity: signal.severity,
            reason: signal.reason,
            subject: questionType?.subject || node?.subject || null,
            label: questionType?.name || node?.title || null,
            questionTypeId: signal.questionTypeId,
            knowledgeNodeId: signal.knowledgeNodeId,
            wrongQuestionId: signal.wrongQuestionId,
            detectedAt: signal.detectedAt,
        };
    }), { goalText, now });
    const limit = Math.min(20, Math.max(1, Number(options.limit || 5)));
    const priorities = ranked.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        signal_id: item.id,
        type: item.type,
        label: item.label,
        subject: item.subject,
        reason: item.reason,
        priority_score: item.priorityScore,
        priority_breakdown: item.priorityBreakdown,
        question_type_id: item.questionTypeId,
        knowledge_node_id: item.knowledgeNodeId,
        wrong_question_id: item.wrongQuestionId,
    }));
    return {
        child_id: childId,
        as_of: now.toISOString(),
        active_goal: activeGoal
            ? { stage_goal_id: activeGoal.id, title: activeGoal.title, objective: activeGoal.objective, end_date: activeGoal.endDate }
            : null,
        signal_count: signals.length,
        priorities,
        planning_required: !activeGoal || priorities.some((item) => item.priority_score >= PLANNING_SIGNAL_THRESHOLD),
    };
}
/**
 * 需要重新规划时创建待规划事项，交给家长或 WorkBuddy 推进。
 * 已有处于生成、待确认或可重试状态的事项时不再重复创建。
 */
export async function ensurePlanningRequest(familyId, childId, now = new Date()) {
    const existing = await prisma.planningRequest.findFirst({
        where: { familyId, childId, status: { in: ["pending", "in_progress", "awaiting_confirmation", "failed"] } },
        orderBy: { createdAt: "desc" },
    });
    if (existing)
        return existing;
    const priorities = await getLearningPriorities(familyId, childId, { limit: 5, now });
    if (priorities.active_goal?.stage_goal_id) {
        const completedForActiveGoal = await prisma.planningRequest.findFirst({
            where: {
                familyId,
                childId,
                status: "completed",
                stageGoalId: priorities.active_goal.stage_goal_id,
            },
            orderBy: { completedAt: "desc" },
        });
        if (completedForActiveGoal)
            return null;
    }
    const top = priorities.priorities[0];
    if (!priorities.planning_required || !top)
        return null;
    return prisma.planningRequest.create({
        data: {
            familyId,
            childId,
            status: "pending",
            source: "system",
            triggerReason: top.reason,
            signalIds: priorities.priorities.map((item) => item.signal_id),
            prioritySnapshot: priorities.priorities,
        },
    });
}
export async function listPlanningRequests(familyId, input = {}) {
    const limit = Math.min(50, Math.max(1, Number(input.limit || 10)));
    const items = await prisma.planningRequest.findMany({
        where: {
            familyId,
            ...(input.child_id ? { childId: input.child_id } : {}),
            ...(input.status ? { status: input.status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
    return { items, total: items.length };
}
export async function getPlanningRequest(familyId, planningRequestId) {
    const request = await prisma.planningRequest.findFirst({ where: { id: planningRequestId, familyId } });
    if (!request)
        throw new LearningEngineError("待规划事项不存在或不属于当前家庭", 404);
    return request;
}
export async function updatePlanningRequestStatus(familyId, planningRequestId, input) {
    await getPlanningRequest(familyId, planningRequestId);
    const allowed = ["pending", "in_progress", "awaiting_confirmation", "failed", "completed", "cancelled"];
    if (!allowed.includes(input.status))
        throw new LearningEngineError("无效的待规划状态");
    return prisma.planningRequest.update({
        where: { id: planningRequestId },
        data: {
            status: input.status,
            stageGoalId: input.stage_goal_id,
            note: input.note,
            completedAt: input.status === "completed" ? new Date() : null,
        },
    });
}
/** 记录某个建议执行后的真实效果，用于后续判断“这套推荐到底有没有用”。 */
export async function recordRecommendationOutcome(familyId, input) {
    const child = await prisma.child.findFirst({ where: { id: input.child_id, familyId } });
    if (!child)
        throw new LearningEngineError("学生不存在或不属于当前家庭", 404);
    if (!input.source_type || !input.source_id || !input.action_type) {
        throw new LearningEngineError("source_type、source_id 和 action_type 不能为空");
    }
    return prisma.recommendationOutcome.create({
        data: {
            familyId,
            childId: input.child_id,
            sourceType: input.source_type,
            sourceId: input.source_id,
            actionType: input.action_type,
            status: input.status || "pending",
            metrics: (input.metrics ?? undefined),
            note: input.note,
            measuredAt: input.measured_at ? new Date(input.measured_at) : undefined,
        },
    });
}
export async function listRecommendationOutcomes(familyId, input = {}) {
    const limit = Math.min(50, Math.max(1, Number(input.limit || 20)));
    const items = await prisma.recommendationOutcome.findMany({
        where: {
            familyId,
            ...(input.child_id ? { childId: input.child_id } : {}),
            ...(input.source_type ? { sourceType: input.source_type } : {}),
            ...(input.source_id ? { sourceId: input.source_id } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
    return { items, total: items.length };
}
