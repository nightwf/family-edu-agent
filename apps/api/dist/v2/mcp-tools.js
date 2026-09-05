import { z } from "zod";
import { getFamilyPolicy, proposeFamilyPolicyChange, reviewFamilyPolicyChange } from "./family-policy.js";
import { createEvidenceRecord, reviewEvidenceRecord } from "./evidence.js";
import { getChildState } from "./child-state.js";
import { getPlanningContext } from "./planning-context.js";
import { confirmStageGoal, createAssessment, createWeeklyPlan, getStageGoal, getWeeklyPlan, listStageGoals, proposeStageGoals, updatePlanItemStatus, } from "./goal-plan.js";
import { ensureEducationMethods, listEducationMethods, saveMethodEffect } from "./education-methods-v2.js";
import { getKnowledgeContext, importSourceDocument, listKnowledgeNodes, listSourceDocuments, saveKnowledgeNodesBatch, upsertChildKnowledgeState, } from "./knowledge.js";
import { getLatestRelationship, listRelationshipHistory, saveRelationshipSnapshot, } from "./relationship.js";
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
        type: z.string(),
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
            type: z.string(),
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
        status: z.string(),
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
            type: z.string(),
            title: z.string(),
            subject: z.string().optional(),
            grade: z.string().optional(),
            description: z.string().optional(),
            content: z.record(z.any()).optional(),
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
            source_page: z.string().optional(),
        })),
    }, async (input) => safe(() => saveKnowledgeNodesBatch(familyId, input.source_document_id, input.nodes)));
    server.tool("get_knowledge_context", { child_id: z.string(), knowledge_node_id: z.string() }, async (input) => safe(() => getKnowledgeContext(familyId, input.child_id, input.knowledge_node_id)));
    server.tool("update_child_knowledge_state", {
        child_id: z.string(),
        knowledge_node_id: z.string(),
        status: z.string().optional(),
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
}
