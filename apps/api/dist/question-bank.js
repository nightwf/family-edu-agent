import { prisma } from "./prisma.js";
export const MASTERY_STATUSES = ["unassessed", "learning", "basic", "mastered", "needs_review"];
export const QUESTION_DIFFICULTIES = ["basic", "advanced", "transfer", "review"];
export const QUESTION_FORMATS = ["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "essay", "calculation"];
export class QuestionBankError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}
const DEFAULT_MASTERY_CRITERIA = {
    minScore: 80,
    minAttempts: 5,
    minVariations: 3,
    requireTransfer: true,
    requireDelayedReview: true,
    delayedHours: 24,
};
function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
export function normalizeMasteryCriteria(value) {
    const input = objectValue(value);
    return {
        minScore: Math.min(100, positiveNumber(input.minScore, DEFAULT_MASTERY_CRITERIA.minScore)),
        minAttempts: Math.max(1, Math.round(positiveNumber(input.minAttempts, DEFAULT_MASTERY_CRITERIA.minAttempts))),
        minVariations: Math.max(1, Math.round(positiveNumber(input.minVariations, DEFAULT_MASTERY_CRITERIA.minVariations))),
        requireTransfer: input.requireTransfer === undefined ? DEFAULT_MASTERY_CRITERIA.requireTransfer : Boolean(input.requireTransfer),
        requireDelayedReview: input.requireDelayedReview === undefined ? DEFAULT_MASTERY_CRITERIA.requireDelayedReview : Boolean(input.requireDelayedReview),
        delayedHours: Math.max(1, positiveNumber(input.delayedHours, DEFAULT_MASTERY_CRITERIA.delayedHours)),
    };
}
function attemptPassed(attempt) {
    return attempt.isCorrect ?? (attempt.score !== null && attempt.score >= 60);
}
export function calculateMastery(attempts, criteriaInput, previousCalculatedStatus = "unassessed", now = new Date()) {
    const criteria = normalizeMasteryCriteria(criteriaInput);
    const ordered = [...attempts].sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
    const totalAttempts = ordered.length;
    const correctAttempts = ordered.filter(attemptPassed).length;
    const independentAttempts = ordered.filter((item) => !item.usedHint).length;
    const independentCorrect = ordered.filter((item) => !item.usedHint && attemptPassed(item)).length;
    const correctRate = totalAttempts ? correctAttempts / totalAttempts : 0;
    let correctStreak = 0;
    for (const attempt of [...ordered].reverse()) {
        if (!attemptPassed(attempt))
            break;
        correctStreak += 1;
    }
    const variationKeys = new Set(ordered.map((item) => item.question.variationType || item.question.difficulty || "original"));
    const variationCount = variationKeys.size;
    const transferAttempts = ordered.filter((item) => item.question.variationType === "transfer" || item.question.difficulty === "transfer");
    const transferCorrect = transferAttempts.filter(attemptPassed).length;
    const transferRate = transferAttempts.length ? transferCorrect / transferAttempts.length : 0;
    const firstIndependentCorrect = ordered.find((item) => !item.usedHint && attemptPassed(item));
    const delayMs = criteria.delayedHours * 60 * 60 * 1000;
    const delayedReviewPassed = Boolean(firstIndependentCorrect && ordered.some((item) => (item !== firstIndependentCorrect
        && !item.usedHint
        && attemptPassed(item)
        && item.attemptedAt.getTime() - firstIndependentCorrect.attemptedAt.getTime() >= delayMs)));
    const components = {
        accuracy: correctRate * 35,
        independence: (totalAttempts ? independentCorrect / totalAttempts : 0) * 20,
        variationCoverage: Math.min(1, variationCount / criteria.minVariations) * 20,
        transfer: transferRate * 15,
        retention: delayedReviewPassed ? 10 : 0,
    };
    const masteryScore = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0) * 10) / 10;
    const mastered = masteryScore >= criteria.minScore
        && totalAttempts >= criteria.minAttempts
        && variationCount >= criteria.minVariations
        && (!criteria.requireTransfer || transferCorrect > 0)
        && (!criteria.requireDelayedReview || delayedReviewPassed);
    let calculatedStatus = "unassessed";
    if (totalAttempts > 0)
        calculatedStatus = "learning";
    if (totalAttempts >= 3 && masteryScore >= 60)
        calculatedStatus = "basic";
    if (mastered)
        calculatedStatus = "mastered";
    if (previousCalculatedStatus === "mastered" && !mastered && totalAttempts > 0)
        calculatedStatus = "needs_review";
    const lastPracticedAt = ordered.at(-1)?.attemptedAt || null;
    const nextReviewDays = calculatedStatus === "mastered" ? 7 : calculatedStatus === "basic" ? 3 : 1;
    const nextReviewAt = lastPracticedAt ? new Date(Math.max(now.getTime(), lastPracticedAt.getTime()) + nextReviewDays * 86_400_000) : null;
    return {
        calculatedStatus,
        masteryScore,
        totalAttempts,
        correctAttempts,
        correctRate: Math.round(correctRate * 1000) / 1000,
        correctStreak,
        independentAttempts,
        variationCount,
        transferScore: transferAttempts.length ? Math.round(transferRate * 1000) / 10 : null,
        lastPracticedAt,
        lastAssessedAt: now,
        nextReviewAt,
        evidence: {
            criteria,
            components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.round(value * 10) / 10])),
            transferAttempts: transferAttempts.length,
            transferCorrect,
            delayedReviewPassed,
            independentCorrect,
            variationTypes: [...variationKeys],
        },
    };
}
export async function requireChild(familyId, childId) {
    const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
    if (!child)
        throw new QuestionBankError("学生不存在或不属于当前家庭", 404);
    return child;
}
export async function requireQuestionType(familyId, questionTypeId) {
    const questionType = await prisma.questionType.findFirst({ where: { id: questionTypeId, familyId } });
    if (!questionType)
        throw new QuestionBankError("题型不存在或不属于当前家庭", 404);
    return questionType;
}
export async function requireQuestion(familyId, questionId) {
    const question = await prisma.question.findFirst({ where: { id: questionId, familyId }, include: { questionType: true } });
    if (!question)
        throw new QuestionBankError("题目不存在或不属于当前家庭", 404);
    return question;
}
export async function recalculateMastery(familyId, childId, questionTypeId) {
    await Promise.all([requireChild(familyId, childId), requireQuestionType(familyId, questionTypeId)]);
    const [attempts, existing, questionType] = await Promise.all([
        prisma.questionAttempt.findMany({
            where: { familyId, childId, questionTypeId },
            include: { question: { select: { variationType: true, difficulty: true } } },
            orderBy: { attemptedAt: "asc" },
        }),
        prisma.studentQuestionTypeMastery.findUnique({ where: { childId_questionTypeId: { childId, questionTypeId } } }),
        prisma.questionType.findFirstOrThrow({ where: { id: questionTypeId, familyId } }),
    ]);
    const result = calculateMastery(attempts, questionType.masteryCriteria, existing?.calculatedStatus);
    const status = existing?.manualStatus || result.calculatedStatus;
    return prisma.studentQuestionTypeMastery.upsert({
        where: { childId_questionTypeId: { childId, questionTypeId } },
        create: { familyId, childId, questionTypeId, status, ...result },
        update: { status, ...result },
        include: { child: true, questionType: true },
    });
}
export async function recordQuestionAttempt(familyId, input) {
    const [child, question] = await Promise.all([
        requireChild(familyId, input.child_id),
        requireQuestion(familyId, input.question_id),
    ]);
    if (input.question_type_id && input.question_type_id !== question.questionTypeId) {
        throw new QuestionBankError("question_type_id 与题目所属题型不一致");
    }
    const attempt = await prisma.questionAttempt.create({
        data: {
            familyId,
            childId: child.id,
            questionId: question.id,
            questionTypeId: question.questionTypeId,
            studentAnswer: input.student_answer,
            isCorrect: input.is_correct,
            score: input.score === undefined ? undefined : Number(input.score),
            durationSeconds: input.duration_seconds === undefined ? undefined : Number(input.duration_seconds),
            usedHint: Boolean(input.used_hint),
            hintCount: Number(input.hint_count || 0),
            errorReason: input.error_reason,
            evaluation: input.evaluation,
            attemptedAt: input.attempted_at ? new Date(input.attempted_at) : new Date(),
        },
    });
    const mastery = await recalculateMastery(familyId, child.id, question.questionTypeId);
    return { attempt, mastery };
}
export async function updateMasteryOverride(familyId, childId, questionTypeId, input) {
    await Promise.all([requireChild(familyId, childId), requireQuestionType(familyId, questionTypeId)]);
    let mastery = await recalculateMastery(familyId, childId, questionTypeId);
    if (input.clear_manual_override) {
        return prisma.studentQuestionTypeMastery.update({
            where: { childId_questionTypeId: { childId, questionTypeId } },
            data: { manualStatus: null, manualReason: null, manualSource: null, status: mastery.calculatedStatus },
            include: { child: true, questionType: true },
        });
    }
    if (!MASTERY_STATUSES.includes(input.status))
        throw new QuestionBankError("无效的掌握状态");
    if (!String(input.reason || "").trim())
        throw new QuestionBankError("人工调整掌握状态时必须填写原因");
    mastery = await prisma.studentQuestionTypeMastery.update({
        where: { childId_questionTypeId: { childId, questionTypeId } },
        data: {
            status: input.status,
            manualStatus: input.status,
            manualReason: String(input.reason).trim(),
            manualSource: input.source || "parent",
            lastAssessedAt: new Date(),
        },
        include: { child: true, questionType: true },
    });
    return mastery;
}
export async function getQuestionGenerationContext(familyId, input) {
    const questionType = await requireQuestionType(familyId, input.question_type_id);
    const child = input.child_id ? await requireChild(familyId, input.child_id) : null;
    const sourceQuestion = input.source_question_id ? await requireQuestion(familyId, input.source_question_id) : null;
    if (sourceQuestion && sourceQuestion.questionTypeId !== questionType.id) {
        throw new QuestionBankError("原题与所选题型不一致");
    }
    const mastery = child ? await prisma.studentQuestionTypeMastery.findUnique({
        where: { childId_questionTypeId: { childId: child.id, questionTypeId: questionType.id } },
    }) : null;
    const recentAttempts = child ? await prisma.questionAttempt.findMany({
        where: { familyId, childId: child.id, questionTypeId: questionType.id },
        include: { question: { select: { id: true, stem: true, difficulty: true, variationType: true } } },
        orderBy: { attemptedAt: "desc" },
        take: 10,
    }) : [];
    const errorReasons = [...new Set(recentAttempts.map((item) => item.errorReason).filter(Boolean))];
    return {
        question_type: questionType,
        source_question: sourceQuestion,
        student: child ? { child_id: child.id, name: child.name, grade: child.grade } : null,
        current_mastery: mastery,
        recent_attempts: recentAttempts,
        weak_points: errorReasons,
        request: {
            target_difficulty: input.target_difficulty || (mastery?.status === "mastered" ? "transfer" : "basic"),
            count: Math.min(20, Math.max(1, Number(input.count || 3))),
        },
        generation_requirements: {
            preserve: questionType.invariants,
            vary: questionType.variableParameters,
            difficulty_ladder: questionType.difficultyLevels,
            rule: questionType.generationRule,
            answer_validation: questionType.answerValidation,
            common_errors: questionType.commonErrors,
            output_schema: {
                stem: "string",
                format: "single_choice|multiple_choice|true_false|fill_blank|short_answer|essay|calculation",
                options: "array or object, optional",
                answer: "JSON value",
                solution: "string",
                scoring_rubric: "object, optional",
                difficulty: "basic|advanced|transfer|review",
                variation_type: "string",
                source_question_id: "string, optional",
                generation_rule_version: questionType.ruleVersion,
            },
        },
    };
}
function value(input, snakeName, camelName) {
    return input[snakeName] !== undefined ? input[snakeName] : input[camelName];
}
function stringArray(input) {
    if (Array.isArray(input))
        return input.map(String).map((item) => item.trim()).filter(Boolean);
    return String(input || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}
function pageValues(input) {
    const limit = Math.min(100, Math.max(1, Number(input.limit || 20)));
    const offset = Math.max(0, Number(input.offset || 0));
    return { limit, offset };
}
function questionTypeData(input) {
    const data = {
        subject: input.subject,
        grade: input.grade,
        name: input.name,
        description: input.description,
        textbook: input.textbook,
        chapter: input.chapter,
        knowledgePoints: value(input, "knowledge_points", "knowledgePoints") === undefined ? undefined : stringArray(value(input, "knowledge_points", "knowledgePoints")),
        tags: input.tags === undefined ? undefined : stringArray(input.tags),
        abilityGoal: value(input, "ability_goal", "abilityGoal"),
        solutionMethod: value(input, "solution_method", "solutionMethod"),
        standardSteps: value(input, "standard_steps", "standardSteps"),
        commonErrors: value(input, "common_errors", "commonErrors"),
        invariants: input.invariants,
        variableParameters: value(input, "variable_parameters", "variableParameters"),
        difficultyLevels: value(input, "difficulty_levels", "difficultyLevels"),
        generationRule: value(input, "generation_rule", "generationRule"),
        answerValidation: value(input, "answer_validation", "answerValidation"),
        masteryCriteria: value(input, "mastery_criteria", "masteryCriteria"),
        ruleVersion: value(input, "rule_version", "ruleVersion"),
        status: input.status,
    };
    return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined));
}
function questionData(input) {
    const data = {
        questionTypeId: value(input, "question_type_id", "questionTypeId"),
        stem: input.stem,
        format: input.format,
        options: input.options,
        answer: input.answer,
        solution: input.solution,
        scoringRubric: value(input, "scoring_rubric", "scoringRubric"),
        difficulty: input.difficulty,
        tags: input.tags === undefined ? undefined : stringArray(input.tags),
        source: input.source,
        originalContent: value(input, "original_content", "originalContent"),
        fileKey: value(input, "file_key", "fileKey"),
        sourceQuestionId: value(input, "source_question_id", "sourceQuestionId"),
        generationRuleVersion: value(input, "generation_rule_version", "generationRuleVersion"),
        variationType: value(input, "variation_type", "variationType"),
        generatedByWorkbuddy: value(input, "generated_by_workbuddy", "generatedByWorkbuddy"),
        status: input.status,
    };
    return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined));
}
export async function createQuestionType(familyId, input) {
    if (!String(input.subject || "").trim() || !String(input.name || "").trim()) {
        throw new QuestionBankError("学科和题型名称不能为空");
    }
    return prisma.questionType.create({
        data: {
            familyId,
            ...questionTypeData(input),
            subject: String(input.subject).trim(),
            name: String(input.name).trim(),
            ruleVersion: value(input, "rule_version", "ruleVersion") || "1.0.0",
            status: input.status || "active",
        },
    });
}
export async function listQuestionTypes(familyId, input = {}) {
    const { limit, offset } = pageValues(input);
    const where = {
        familyId,
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.grade ? { grade: input.grade } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.knowledge_point ? { knowledgePoints: { has: input.knowledge_point } } : {}),
    };
    if (input.query) {
        where.OR = ["name", "description", "chapter", "abilityGoal"].map((field) => ({
            [field]: { contains: input.query, mode: "insensitive" },
        }));
    }
    const [items, total] = await Promise.all([
        prisma.questionType.findMany({
            where,
            include: { _count: { select: { questions: true, masteries: true } } },
            orderBy: [{ subject: "asc" }, { grade: "asc" }, { createdAt: "desc" }],
            take: limit,
            skip: offset,
        }),
        prisma.questionType.count({ where }),
    ]);
    return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}
export async function getQuestionType(familyId, questionTypeId) {
    await requireQuestionType(familyId, questionTypeId);
    return prisma.questionType.findFirst({
        where: { id: questionTypeId, familyId },
        include: {
            questions: { where: { status: { not: "deleted" } }, orderBy: { createdAt: "desc" }, take: 50 },
            masteries: { include: { child: true }, orderBy: { updatedAt: "desc" } },
        },
    });
}
export async function updateQuestionType(familyId, questionTypeId, input) {
    await requireQuestionType(familyId, questionTypeId);
    const data = questionTypeData(input);
    return prisma.questionType.update({ where: { id: questionTypeId }, data });
}
export async function deleteQuestionType(familyId, questionTypeId) {
    await requireQuestionType(familyId, questionTypeId);
    const questionCount = await prisma.question.count({ where: { familyId, questionTypeId } });
    if (questionCount > 0)
        throw new QuestionBankError("该题型已有题目，不能直接删除；请先停用或处理关联题目", 409);
    await prisma.questionType.delete({ where: { id: questionTypeId } });
    return { ok: true, question_type_id: questionTypeId };
}
export async function createQuestion(familyId, input) {
    const questionTypeId = value(input, "question_type_id", "questionTypeId");
    if (!questionTypeId || !String(input.stem || "").trim())
        throw new QuestionBankError("题型和题干不能为空");
    const questionType = await requireQuestionType(familyId, questionTypeId);
    const sourceQuestionId = value(input, "source_question_id", "sourceQuestionId");
    if (sourceQuestionId) {
        const source = await requireQuestion(familyId, sourceQuestionId);
        if (source.questionTypeId !== questionType.id)
            throw new QuestionBankError("来源题目与当前题型不一致");
    }
    return prisma.question.create({
        data: {
            familyId,
            ...questionData(input),
            questionTypeId,
            stem: String(input.stem).trim(),
            format: input.format || "short_answer",
            difficulty: input.difficulty || "basic",
            source: input.source || "workbuddy",
            generationRuleVersion: value(input, "generation_rule_version", "generationRuleVersion") || questionType.ruleVersion,
            generatedByWorkbuddy: Boolean(value(input, "generated_by_workbuddy", "generatedByWorkbuddy")),
            status: input.status || "active",
        },
        include: { questionType: true },
    });
}
export async function createQuestionsBatch(familyId, questions) {
    if (!Array.isArray(questions) || questions.length === 0)
        throw new QuestionBankError("questions 不能为空");
    if (questions.length > 50)
        throw new QuestionBankError("单次最多保存 50 道题");
    for (const question of questions) {
        if (!value(question, "question_type_id", "questionTypeId") || !String(question.stem || "").trim()) {
            throw new QuestionBankError("批量题目中的题型和题干不能为空");
        }
    }
    const typeIds = [...new Set(questions.map((item) => value(item, "question_type_id", "questionTypeId")))];
    const types = await prisma.questionType.findMany({ where: { familyId, id: { in: typeIds } } });
    if (types.length !== typeIds.length)
        throw new QuestionBankError("批量题目中包含不存在或不属于当前家庭的题型", 404);
    const typeMap = new Map(types.map((item) => [item.id, item]));
    const sourceIds = [...new Set(questions.map((item) => value(item, "source_question_id", "sourceQuestionId")).filter(Boolean))];
    const sources = sourceIds.length ? await prisma.question.findMany({ where: { familyId, id: { in: sourceIds } } }) : [];
    if (sources.length !== sourceIds.length)
        throw new QuestionBankError("批量题目中包含不存在或不属于当前家庭的来源题目", 404);
    const sourceMap = new Map(sources.map((item) => [item.id, item]));
    const operations = questions.map((input) => {
        const questionTypeId = value(input, "question_type_id", "questionTypeId");
        const sourceQuestionId = value(input, "source_question_id", "sourceQuestionId");
        if (sourceQuestionId && sourceMap.get(sourceQuestionId)?.questionTypeId !== questionTypeId) {
            throw new QuestionBankError("批量题目中的来源题目与题型不一致");
        }
        return prisma.question.create({
            data: {
                familyId,
                ...questionData(input),
                questionTypeId,
                stem: String(input.stem).trim(),
                format: input.format || "short_answer",
                difficulty: input.difficulty || "basic",
                source: input.source || "workbuddy",
                generationRuleVersion: value(input, "generation_rule_version", "generationRuleVersion") || typeMap.get(questionTypeId)?.ruleVersion,
                generatedByWorkbuddy: input.generated_by_workbuddy === undefined ? true : Boolean(input.generated_by_workbuddy),
                status: input.status || "active",
            },
            include: { questionType: true },
        });
    });
    const created = await prisma.$transaction(operations);
    return { items: created, count: created.length };
}
export async function listQuestions(familyId, input = {}) {
    const { limit, offset } = pageValues(input);
    const questionTypeWhere = {
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.grade ? { grade: input.grade } : {}),
        ...(input.chapter ? { chapter: input.chapter } : {}),
        ...(input.knowledge_point ? { knowledgePoints: { has: input.knowledge_point } } : {}),
    };
    const where = {
        familyId,
        ...(input.question_type_id ? { questionTypeId: input.question_type_id } : {}),
        ...(input.difficulty ? { difficulty: input.difficulty } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.query ? { stem: { contains: input.query, mode: "insensitive" } } : {}),
        ...(Object.keys(questionTypeWhere).length ? { questionType: questionTypeWhere } : {}),
    };
    const childId = input.child_id;
    if (childId)
        await requireChild(familyId, childId);
    const [items, total] = await Promise.all([
        prisma.question.findMany({
            where,
            include: {
                questionType: {
                    include: childId ? { masteries: { where: { childId }, take: 1 } } : undefined,
                },
                _count: { select: { attempts: true } },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
        }),
        prisma.question.count({ where }),
    ]);
    return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}
export async function getQuestion(familyId, questionId) {
    await requireQuestion(familyId, questionId);
    return prisma.question.findFirst({
        where: { id: questionId, familyId },
        include: {
            questionType: true,
            attempts: { include: { child: true }, orderBy: { attemptedAt: "desc" }, take: 100 },
        },
    });
}
export async function updateQuestion(familyId, questionId, input) {
    const existing = await requireQuestion(familyId, questionId);
    const data = questionData(input);
    if (data.questionTypeId && data.questionTypeId !== existing.questionTypeId) {
        const attemptCount = await prisma.questionAttempt.count({ where: { familyId, questionId } });
        if (attemptCount)
            throw new QuestionBankError("已有作答记录的题目不能变更题型", 409);
        await requireQuestionType(familyId, data.questionTypeId);
    }
    return prisma.question.update({ where: { id: questionId }, data, include: { questionType: true } });
}
export async function deleteQuestion(familyId, questionId) {
    await requireQuestion(familyId, questionId);
    const attemptCount = await prisma.questionAttempt.count({ where: { familyId, questionId } });
    if (attemptCount > 0)
        throw new QuestionBankError("该题目已有学生作答记录，不能直接删除；请改为停用", 409);
    await prisma.question.delete({ where: { id: questionId } });
    return { ok: true, question_id: questionId };
}
export async function listQuestionAttempts(familyId, input = {}) {
    const { limit, offset } = pageValues(input);
    if (input.child_id)
        await requireChild(familyId, input.child_id);
    if (input.question_id)
        await requireQuestion(familyId, input.question_id);
    if (input.question_type_id)
        await requireQuestionType(familyId, input.question_type_id);
    const where = {
        familyId,
        ...(input.child_id ? { childId: input.child_id } : {}),
        ...(input.question_id ? { questionId: input.question_id } : {}),
        ...(input.question_type_id ? { questionTypeId: input.question_type_id } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.questionAttempt.findMany({
            where,
            include: { child: true, question: true, questionType: true },
            orderBy: { attemptedAt: "desc" },
            take: limit,
            skip: offset,
        }),
        prisma.questionAttempt.count({ where }),
    ]);
    return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}
export async function getStudentMastery(familyId, childId, questionTypeId) {
    await Promise.all([requireChild(familyId, childId), requireQuestionType(familyId, questionTypeId)]);
    const existing = await prisma.studentQuestionTypeMastery.findUnique({
        where: { childId_questionTypeId: { childId, questionTypeId } },
        include: { child: true, questionType: true },
    });
    return existing || recalculateMastery(familyId, childId, questionTypeId);
}
export async function listStudentMastery(familyId, input = {}) {
    const { limit, offset } = pageValues(input);
    if (input.child_id)
        await requireChild(familyId, input.child_id);
    const where = {
        familyId,
        ...(input.child_id ? { childId: input.child_id } : {}),
        ...(input.question_type_id ? { questionTypeId: input.question_type_id } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.subject ? { questionType: { subject: input.subject } } : {}),
    };
    const [items, total] = await Promise.all([
        prisma.studentQuestionTypeMastery.findMany({
            where,
            include: { child: true, questionType: true },
            orderBy: [{ status: "asc" }, { masteryScore: "asc" }, { updatedAt: "desc" }],
            take: limit,
            skip: offset,
        }),
        prisma.studentQuestionTypeMastery.count({ where }),
    ]);
    return { items, total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length };
}
