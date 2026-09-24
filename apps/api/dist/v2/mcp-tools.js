import { z } from "zod";
import { prisma } from "../prisma.js";
import { getFamilyPolicy, proposeFamilyPolicyChange, reviewFamilyPolicyChange } from "./family-policy.js";
import { createEvidenceRecord, reviewEvidenceRecord } from "./evidence.js";
import { getChildState } from "./child-state.js";
import { getPlanningContext } from "./planning-context.js";
import { getSubjectOverview } from "./subject-overview.js";
import { confirmStageGoal, createAssessment, createWeeklyPlan, getStageGoal, getWeeklyPlan, listStageGoals, proposeStageGoals, updatePlanItemStatus, } from "./goal-plan.js";
import { ensureEducationMethods, listEducationMethods, saveMethodEffect } from "./education-methods-v2.js";
import { getKnowledgeContext, importSourceDocument, listKnowledgeNodes, listSourceDocuments, saveKnowledgeRelationsBatch, saveKnowledgeNodesBatch, upsertChildKnowledgeState, } from "./knowledge.js";
import { getLatestRelationship, listRelationshipHistory, saveRelationshipSnapshot, } from "./relationship.js";
import { ensurePlanningRequest, getLearningPriorities, getPlanningRequest, linkQuestionKnowledgeNodes, linkQuestionTypeKnowledgeNodes, listPlanningRequests, listQuestionKnowledgeNodes, listQuestionTypeKnowledgeNodes, listRecommendationOutcomes, recordRecommendationOutcome, resolveLearningSignal, syncLearningSignals, unlinkQuestionTypeKnowledgeNode, updatePlanningRequestStatus, } from "./learning-engine.js";
import { verifyStoredQuestion } from "../question-bank.js";
function textResult(payload) {
    return {
        content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    };
}
async function safe(action) {
    try {
        return textResult(await action());
    }
    catch (error) {
        return {
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : "操作失败" }],
        };
    }
}
export function registerV2McpTools(server, familyId) {
    server.tool("get_family_policy", "读取当前家庭的边界、目标和原则。", {}, async () => safe(() => getFamilyPolicy(familyId)));
    server.tool("propose_family_policy_change", {
        type: z.string(),
        summary: z.string().optional(),
        reason: z.string().optional(),
        after: z.record(z.any()),
    }, async (input) => safe(() => proposeFamilyPolicyChange(familyId, {
        type: input.type,
        summary: input.summary,
        reason: input.reason,
        after: input.after,
    })));
    server.tool("review_family_policy_change", {
        change_id: z.string(),
        action: z.enum(["approved", "ignored"]),
    }, async (input) => safe(() => reviewFamilyPolicyChange(familyId, input.change_id, input.action, { type: "parent" })));
    server.tool("get_child_state", { child_id: z.string() }, async ({ child_id }) => safe(() => getChildState(familyId, child_id)));
    server.tool("save_evidence_record", {
        child_id: z.string(),
        type: z
            .string()
            .describe("证据类型。合法值：OBSERVATION（行为观察）、WRITING（写作）、READING（阅读）、HOMEWORK_COMPLETION（作业完成）、QUESTION_ATTEMPT（作答记录）、RETEST（复测结果）、PARENT_NOTE（家长记录）。也可以直接写中文名称。"),
        task_description: z.string().optional(),
        environment: z.string().optional(),
        observed_behavior: z.string().optional(),
        frequency: z.string().optional(),
        effective_strategy: z.string().optional(),
        counter_evidence: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
        source_ref: z.string().optional(),
        observed_at: z.string().optional(),
    }, async (input) => safe(() => createEvidenceRecord(familyId, {
        childId: input.child_id,
        type: input.type,
        taskDescription: input.task_description,
        environment: input.environment,
        observedBehavior: input.observed_behavior,
        frequency: input.frequency,
        effectiveStrategy: input.effective_strategy,
        counterEvidence: input.counter_evidence,
        confidence: input.confidence,
        sourceRef: input.source_ref,
        observedAt: input.observed_at,
    })));
    server.tool("review_evidence_record", {
        evidence_id: z.string(),
        action: z.enum(["confirm", "correct"]),
        note: z.string().optional(),
    }, async (input) => safe(() => reviewEvidenceRecord(familyId, input.evidence_id, input.action, { type: "parent" }, input.note)));
    server.tool("get_planning_context", { child_id: z.string(), purpose: z.string().optional() }, async ({ child_id }) => safe(() => getPlanningContext(familyId, child_id)));
    server.tool("propose_stage_goals", {
        child_id: z.string(),
        goals: z.array(z.object({
            title: z.string(),
            objective: z.string(),
            criteria: z.record(z.any()).optional(),
            start_date: z.string(),
            end_date: z.string(),
            method_ids: z.array(z.string()).optional(),
        })),
    }, async (input) => safe(() => proposeStageGoals(familyId, input.child_id, input.goals.map((goal) => ({
        title: goal.title,
        objective: goal.objective,
        criteria: goal.criteria,
        startDate: goal.start_date,
        endDate: goal.end_date,
        methodIds: goal.method_ids,
    })))));
    server.tool("list_stage_goals", { child_id: z.string().optional(), status: z.string().optional() }, async (input) => safe(() => listStageGoals(familyId, { childId: input.child_id, status: input.status })));
    server.tool("get_stage_goal", { goal_id: z.string() }, async ({ goal_id }) => safe(() => getStageGoal(familyId, goal_id)));
    server.tool("confirm_stage_goal", {
        goal_id: z.string(),
        action: z.enum(["confirm", "cancel", "reject"]),
        changes: z.record(z.any()).optional(),
    }, async (input) => safe(() => confirmStageGoal(familyId, input.goal_id, input.action, { type: "parent" }, input.changes)));
    server.tool("create_weekly_plan", {
        goal_id: z.string(),
        week_start: z.string(),
        items: z.array(z.object({
            type: z
                .string()
                .describe("任务类型。合法值：SCHOOL_HOMEWORK（学校作业）、CHILD_TASK（孩子任务）、PARENT_ACTION（家长行动）、AGENT_TASK（AI 任务）、RETEST（复测）。也可以直接写中文名称。"),
            title: z.string(),
            description: z.string().optional(),
            estimated_minutes: z.number().optional(),
            due_at: z.string().optional(),
            method_id: z.string().optional(),
            source_ref: z.string().optional(),
        })),
    }, async (input) => safe(() => createWeeklyPlan(familyId, input.goal_id, input.week_start, input.items.map((item) => ({
        type: item.type,
        title: item.title,
        description: item.description,
        estimatedMinutes: item.estimated_minutes,
        dueAt: item.due_at,
        methodId: item.method_id,
        sourceRef: item.source_ref,
    })))));
    server.tool("get_weekly_plan", { plan_id: z.string() }, async ({ plan_id }) => safe(() => getWeeklyPlan(familyId, plan_id)));
    server.tool("update_plan_item_status", {
        plan_item_id: z.string(),
        status: z
            .string()
            .describe("任务状态。合法值：PENDING（待开始）、IN_PROGRESS（进行中）、COMPLETED（已完成）、SKIPPED（已跳过）、CANCELLED（已取消）、NEEDS_REVIEW（需复测）。也可以直接写中文名称。"),
        evidence: z.record(z.any()).optional(),
    }, async (input) => safe(() => updatePlanItemStatus(familyId, input.plan_item_id, {
        status: input.status,
        evidence: input.evidence,
    })));
    server.tool("create_assessment", {
        child_id: z.string(),
        goal_id: z.string().optional(),
        plan_item_id: z.string().optional(),
        title: z.string(),
        assessment_type: z.string(),
        criteria: z.record(z.any()).optional(),
        score: z.number().optional(),
        passed: z.boolean().optional(),
        outcome: z.record(z.any()).optional(),
        source_ref: z.string().optional(),
        observed_at: z.string().optional(),
    }, async (input) => safe(() => createAssessment(familyId, {
        childId: input.child_id,
        stageGoalId: input.goal_id,
        planItemId: input.plan_item_id,
        title: input.title,
        assessmentType: input.assessment_type,
        criteria: input.criteria,
        score: input.score,
        passed: input.passed,
        outcome: input.outcome,
        sourceRef: input.source_ref,
        observedAt: input.observed_at,
    })));
    server.tool("list_source_documents", { subject: z.string().optional(), grade: z.string().optional() }, async (input) => safe(() => listSourceDocuments(familyId, input)));
    server.tool("import_source_document", {
        title: z.string(),
        kind: z.string(),
        subject: z.string().optional(),
        grade: z.string().optional(),
        publisher: z.string().optional(),
        version: z.string().optional(),
        file_key: z.string().optional(),
        nodes: z
            .array(z.object({
            type: z
                .string()
                .describe("知识节点类型。合法值：CHAPTER（章节）、KNOWLEDGE_POINT（知识点）、CONCEPT（概念）、EXAMPLE（例题）、MISCONCEPTION（常见错误）。"),
            title: z.string(),
            subject: z.string().optional(),
            grade: z.string().optional(),
            description: z.string().optional(),
            content: z.record(z.any()).optional(),
            evidence: z.array(z.any()).or(z.record(z.any())).optional(),
            assessment_prompt: z.string().optional(),
            common_errors: z.array(z.any()).or(z.record(z.any())).optional(),
            source_page: z.string().optional(),
        }))
            .optional(),
    }, async (input) => safe(() => importSourceDocument(familyId, {
        title: input.title,
        kind: input.kind,
        subject: input.subject,
        grade: input.grade,
        publisher: input.publisher,
        version: input.version,
        fileKey: input.file_key,
        nodes: input.nodes,
    })));
    server.tool("list_knowledge_nodes", { subject: z.string().optional(), grade: z.string().optional(), source_document_id: z.string().optional() }, async (input) => safe(() => listKnowledgeNodes(familyId, input)));
    server.tool("save_knowledge_nodes_batch", {
        source_document_id: z.string(),
        nodes: z.array(z.object({
            type: z.string(),
            title: z.string(),
            subject: z.string().optional(),
            grade: z.string().optional(),
            description: z.string().optional(),
            content: z.record(z.any()).optional(),
            evidence: z.array(z.any()).or(z.record(z.any())).optional(),
            assessment_prompt: z.string().optional(),
            common_errors: z.array(z.any()).or(z.record(z.any())).optional(),
            source_page: z.string().optional(),
        })),
    }, async (input) => safe(() => saveKnowledgeNodesBatch(familyId, input.source_document_id, input.nodes)));
    server.tool("save_knowledge_relations_batch", "保存同一来源文档中知识点之间的关系，推荐使用 PREREQUISITE_OF 表达前置依赖，并补充 hard/soft 强度与原因。", {
        source_document_id: z.string(),
        relations: z.array(z.object({
            prerequisite_title: z.string(),
            dependent_title: z.string(),
            relation_type: z
                .string()
                .optional()
                .describe("关系类型。合法值：PREREQUISITE_OF（前置依赖）、CONTAINS（包含）、RELATED_TO（相关）、EXAMPLE_OF（例题属于）、ERROR_OF（易错点属于）。默认 PREREQUISITE_OF。"),
            strength: z.enum(["hard", "soft"]).optional(),
            reason: z.string().optional(),
        })),
    }, async (input) => safe(() => saveKnowledgeRelationsBatch(familyId, input.source_document_id, input.relations.map((relation) => ({
        prerequisiteTitle: relation.prerequisite_title,
        dependentTitle: relation.dependent_title,
        relationType: relation.relation_type,
        strength: relation.strength,
        reason: relation.reason,
    })))));
    server.tool("get_knowledge_context", { child_id: z.string(), knowledge_node_id: z.string() }, async (input) => safe(() => getKnowledgeContext(familyId, input.child_id, input.knowledge_node_id)));
    server.tool("update_child_knowledge_state", {
        child_id: z.string(),
        knowledge_node_id: z.string(),
        status: z
            .string()
            .optional()
            .describe("掌握状态。合法值：UNASSESSED（未评估）、LEARNING（学习中）、PARTIAL（部分掌握）、MASTERED（已掌握）、NEEDS_REVIEW（需复习）。也可以直接写中文名称。"),
        score: z.number().min(0).max(100).optional(),
        evidence: z.record(z.any()).optional(),
        manual_reason: z.string().optional(),
    }, async (input) => safe(() => upsertChildKnowledgeState(familyId, {
        childId: input.child_id,
        knowledgeNodeId: input.knowledge_node_id,
        status: input.status,
        score: input.score,
        evidence: input.evidence,
        manualReason: input.manual_reason,
    })));
    server.tool("list_education_methods", { category: z.string().optional() }, async (input) => safe(async () => {
        await ensureEducationMethods();
        return listEducationMethods(input);
    }));
    server.tool("get_child_relationship", { child_id: z.string() }, async ({ child_id }) => safe(() => getLatestRelationship(familyId, child_id)));
    server.tool("save_child_relationship", {
        child_id: z.string(),
        status: z.string().optional(),
        score: z.number().min(0).max(100).optional(),
        communication_note: z.string().optional(),
        conflict_count: z.number().int().min(0).optional(),
        parent_action: z.string().optional(),
        evidence: z.record(z.any()).optional(),
    }, async (input) => safe(() => saveRelationshipSnapshot(familyId, {
        childId: input.child_id,
        status: input.status,
        score: input.score,
        communicationNote: input.communication_note,
        conflictCount: input.conflict_count,
        parentAction: input.parent_action,
        evidence: input.evidence,
    })));
    server.tool("list_child_relationship_history", {
        child_id: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
    }, async ({ child_id, limit, offset }) => safe(() => listRelationshipHistory(familyId, child_id, limit, offset)));
    server.tool("save_method_effect", {
        child_id: z.string(),
        method_id: z.string(),
        goal_id: z.string().optional(),
        outcome: z.string(),
        context: z.record(z.any()).optional(),
        confidence: z.number().min(0).max(1).optional(),
        evidence_ref: z.string().optional(),
    }, async (input) => safe(() => saveMethodEffect(familyId, {
        childId: input.child_id,
        methodId: input.method_id,
        goalId: input.goal_id,
        outcome: input.outcome,
        context: input.context,
        confidence: input.confidence,
        evidenceRef: input.evidence_ref,
    })));
    // ---- 学习决策层：信号、优先级、知识关联、待规划事项 ----
    server.tool("get_learning_priorities", "读取学生当前的学习优先级。禾芽按“前置缺口 > 重复出错 > 复测到期 > 掌握度偏低 > 变式不足”的规则算好，制定目标前必须先读，并说明每条优先级的依据。", { child_id: z.string(), limit: z.number().min(1).max(20).optional() }, async ({ child_id, limit }) => safe(() => getLearningPriorities(familyId, child_id, { limit })));
    // ---- 学科概览：只读。回答“哪一科需要优先处理”时先读这个，别拿单点数据猜全貌。----
    server.tool("get_subject_overview", "读取学生各学科的整体概览（含没有数据的学科）。用于回答“哪一科要优先处理”“各科现在什么情况”。", { child_id: z.string() }, async ({ child_id }) => safe(() => getSubjectOverview(familyId, child_id)));
    server.tool("list_learning_signals", "列出学生学习信号的当前状态。信号来自真实作答与错题，不是模型推断。", { child_id: z.string(), refresh: z.boolean().optional() }, async ({ child_id, refresh }) => safe(() => refresh === false
        ? prisma.learningSignal.findMany({ where: { familyId, childId: child_id, status: "active" }, orderBy: [{ severity: "desc" }, { detectedAt: "desc" }] })
        : syncLearningSignals(familyId, child_id)));
    server.tool("resolve_learning_signal", "把某个学习信号标记为已解决或已忽略。忽略只影响这一条，下次数据仍触发时会重新出现。", { signal_id: z.string(), status: z.enum(["resolved", "dismissed"]).optional(), note: z.string().optional() }, async ({ signal_id, status, note }) => safe(() => resolveLearningSignal(familyId, signal_id, { status, note })));
    server.tool("link_question_type_knowledge", "把题型关联到教材知识节点，让题型掌握度能追溯到知识图谱。导入教材或新建题型后使用。", {
        question_type_id: z.string(),
        links: z.array(z.object({ knowledge_node_id: z.string(), role: z.string().optional(), weight: z.number().optional() })),
    }, async ({ question_type_id, links }) => safe(() => linkQuestionTypeKnowledgeNodes(familyId, question_type_id, links)));
    server.tool("list_question_type_knowledge", "读取一个题型已关联的知识节点。", { question_type_id: z.string() }, async ({ question_type_id }) => safe(() => listQuestionTypeKnowledgeNodes(familyId, question_type_id)));
    server.tool("unlink_question_type_knowledge", "解除题型与某个知识节点的关联。", { question_type_id: z.string(), knowledge_node_id: z.string() }, async ({ question_type_id, knowledge_node_id }) => safe(() => unlinkQuestionTypeKnowledgeNode(familyId, question_type_id, knowledge_node_id)));
    server.tool("link_question_knowledge", "为单道题目指定知识节点，会覆盖题型的默认关联，用于一道题考察多个知识点。", {
        question_id: z.string(),
        links: z.array(z.object({ knowledge_node_id: z.string(), role: z.string().optional(), weight: z.number().optional() })),
    }, async ({ question_id, links }) => safe(() => linkQuestionKnowledgeNodes(familyId, question_id, links)));
    server.tool("list_question_knowledge", "读取一道题目已关联的知识节点。", { question_id: z.string() }, async ({ question_id }) => safe(() => listQuestionKnowledgeNodes(familyId, question_id)));
    server.tool("create_planning_request", "把某个学生标记为需要重新规划。禾芽只登记待规划事项，不生成计划本身，计划由 WorkBuddy 读取上下文后制定。", { child_id: z.string(), note: z.string().optional() }, async ({ child_id, note }) => safe(async () => {
        const request = await ensurePlanningRequest(familyId, child_id);
        if (!request)
            throw new Error("当前没有达到需要重新规划的阈值");
        if (note)
            return updatePlanningRequestStatus(familyId, request.id, { status: request.status, note });
        return request;
    }));
    server.tool("list_planning_requests", "列出待规划事项，用于确认哪些学生还没有生成学习计划。", { child_id: z.string().optional(), status: z.string().optional(), limit: z.number().min(1).max(50).optional() }, async ({ child_id, status, limit }) => safe(() => listPlanningRequests(familyId, { child_id, status, limit })));
    server.tool("get_planning_request", "读取一条待规划事项及其优先级快照。", { planning_request_id: z.string() }, async ({ planning_request_id }) => safe(() => getPlanningRequest(familyId, planning_request_id)));
    server.tool("update_planning_request_status", "更新待规划事项状态：开始规划用 in_progress，候选目标写回后可从 pending 直接到 completed，作废用 cancelled。", {
        planning_request_id: z.string(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
        stage_goal_id: z.string().optional(),
        note: z.string().optional(),
    }, async ({ planning_request_id, status, stage_goal_id, note }) => safe(() => updatePlanningRequestStatus(familyId, planning_request_id, { status, stage_goal_id, note })));
    server.tool("record_recommendation_outcome", "记录一次建议执行后的真实效果，用于判断推荐是否有效。", {
        child_id: z.string(),
        source_type: z.string(),
        source_id: z.string(),
        action_type: z.string(),
        status: z.enum(["pending", "improved", "unchanged", "worse", "unmeasurable"]).optional(),
        metrics: z.record(z.any()).optional(),
        note: z.string().optional(),
        measured_at: z.string().datetime().optional(),
    }, async (input) => safe(() => recordRecommendationOutcome(familyId, {
        child_id: input.child_id,
        source_type: input.source_type,
        source_id: input.source_id,
        action_type: input.action_type,
        status: input.status,
        metrics: input.metrics,
        note: input.note,
        measured_at: input.measured_at,
    })));
    server.tool("list_recommendation_outcomes", "读取建议执行效果记录。", {
        child_id: z.string().optional(),
        source_type: z.string().optional(),
        source_id: z.string().optional(),
        limit: z.number().min(1).max(50).optional(),
    }, async (input) => safe(() => listRecommendationOutcomes(familyId, input)));
    server.tool("verify_question_answer", "对已入库题目重新验证答案。客观题用确定性规则核对，主观题会标记为需要评分量表或人工确认。", { question_id: z.string() }, async ({ question_id }) => safe(() => verifyStoredQuestion(familyId, question_id)));
}
