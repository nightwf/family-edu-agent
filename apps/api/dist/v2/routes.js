import { getFamilyPolicy, updateFamilyPolicy } from "./family-policy.js";
import { createEvidenceRecord, listEvidence, reviewEvidenceRecord } from "./evidence.js";
import { confirmStageGoal, confirmWeeklyPlan, createAssessment, createWeeklyPlan, getStageGoal, getWeeklyPlan, listStageGoals, proposeStageGoals, updatePlanItemStatus, } from "./goal-plan.js";
import { ensureEducationMethods, listEducationMethods, saveMethodEffect } from "./education-methods-v2.js";
import { getKnowledgeContext, importSourceDocument, listKnowledgeNodes, listSourceDocuments, saveKnowledgeRelationsBatch, saveKnowledgeNodesBatch, upsertChildKnowledgeState, } from "./knowledge.js";
import { getLatestRelationship, listRelationshipHistory, saveRelationshipSnapshot, } from "./relationship.js";
import { ensurePlanningRequest, getLearningPriorities, getPlanningRequest, linkQuestionKnowledgeNodes, linkQuestionTypeKnowledgeNodes, listPlanningRequests, listQuestionKnowledgeNodes, listQuestionTypeKnowledgeNodes, listRecommendationOutcomes, recordRecommendationOutcome, resolveLearningSignal, syncLearningSignals, unlinkQuestionTypeKnowledgeNode, updatePlanningRequestStatus, } from "./learning-engine.js";
import { verifyStoredQuestion } from "../question-bank.js";
import { confirmAiPlanDraft, generateAiPlanDraft } from "./ai-planner.js";
async function respond(reply, action) {
    try {
        return await action();
    }
    catch (error) {
        if (error instanceof Error)
            return reply.code(400).send({ error: error.message });
        throw error;
    }
}
export function registerV2Routes(app, requireAuth, getAuth) {
    const auth = { preHandler: requireAuth };
    app.get("/api/v2/family/policy", auth, async (request) => {
        const { familyId } = getAuth(request);
        return getFamilyPolicy(familyId);
    });
    app.put("/api/v2/family/policy", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const body = request.body;
        return respond(reply, () => updateFamilyPolicy(familyId, {
            weeklyTimeBudget: body.weekly_time_budget,
            prioritySubjects: body.priority_subjects,
            pressureBoundary: body.pressure_boundary,
            parentGoals: body.parent_goals,
            principles: body.principles,
        }, { type: "parent", id }));
    });
    app.get("/api/v2/children/:childId/evidence", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        return listEvidence(familyId, { childId, ...request.query });
    });
    app.post("/api/v2/children/:childId/evidence", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { childId } = request.params;
        const body = request.body;
        return respond(reply.code(201), () => createEvidenceRecord(familyId, {
            childId,
            type: body.type,
            taskDescription: body.task_description,
            environment: body.environment,
            observedBehavior: body.observed_behavior,
            frequency: body.frequency,
            effectiveStrategy: body.effective_strategy,
            counterEvidence: body.counter_evidence,
            confidence: body.confidence,
            source: body.source,
            sourceRef: body.source_ref,
            observedAt: body.observed_at,
        }, { type: body.source || "parent", id }));
    });
    app.patch("/api/v2/evidence/:evidenceId/review", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { evidenceId } = request.params;
        const body = request.body;
        return respond(reply, () => reviewEvidenceRecord(familyId, evidenceId, body.action, { type: "parent", id }, body.note));
    });
    app.get("/api/v2/children/:childId/goals", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        return listStageGoals(familyId, { childId, ...request.query });
    });
    app.post("/api/v2/children/:childId/goals/propose", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { childId } = request.params;
        const body = request.body;
        return respond(reply.code(201), () => proposeStageGoals(familyId, childId, body.goals, { type: "workbuddy", id }));
    });
    app.get("/api/v2/goals/:goalId", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { goalId } = request.params;
        return getStageGoal(familyId, goalId);
    });
    app.patch("/api/v2/goals/:goalId", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { goalId } = request.params;
        const body = request.body;
        return respond(reply, () => confirmStageGoal(familyId, goalId, body.action, { type: "parent", id }, body.changes));
    });
    app.post("/api/v2/goals/:goalId/plans", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { goalId } = request.params;
        const body = request.body;
        return respond(reply.code(201), () => createWeeklyPlan(familyId, goalId, body.week_start, body.items, { type: "workbuddy", id }));
    });
    app.get("/api/v2/plans/:planId", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { planId } = request.params;
        return getWeeklyPlan(familyId, planId);
    });
    app.patch("/api/v2/plans/:planId/confirm", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { planId } = request.params;
        return respond(reply, () => confirmWeeklyPlan(familyId, planId, { type: "parent", id }));
    });
    app.patch("/api/v2/plan-items/:planItemId/status", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { planItemId } = request.params;
        const body = request.body;
        return respond(reply, () => updatePlanItemStatus(familyId, planItemId, {
            status: body.status,
            evidence: body.evidence,
        }, { type: "workbuddy", id }));
    });
    app.post("/api/v2/goals/:goalId/assessments", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { goalId } = request.params;
        const body = request.body;
        return respond(reply.code(201), () => createAssessment(familyId, {
            childId: body.child_id,
            stageGoalId: goalId,
            planItemId: body.plan_item_id,
            title: body.title,
            assessmentType: body.assessment_type,
            criteria: body.criteria,
            score: body.score,
            passed: body.passed,
            outcome: body.outcome,
            sourceRef: body.source_ref,
            observedAt: body.observed_at,
        }, { type: "workbuddy", id }));
    });
    app.get("/api/v2/source-documents", auth, async (request) => {
        const { familyId } = getAuth(request);
        return listSourceDocuments(familyId, request.query);
    });
    app.post("/api/v2/source-documents", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const body = request.body;
        return respond(reply.code(201), () => importSourceDocument(familyId, {
            title: body.title,
            kind: body.kind,
            subject: body.subject,
            grade: body.grade,
            publisher: body.publisher,
            version: body.version,
            fileKey: body.file_key,
            nodes: body.nodes,
        }, { type: "workbuddy", id }));
    });
    app.get("/api/v2/knowledge-nodes", auth, async (request) => {
        const { familyId } = getAuth(request);
        return listKnowledgeNodes(familyId, request.query);
    });
    app.post("/api/v2/knowledge-nodes/import", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const body = request.body;
        return respond(reply.code(201), () => saveKnowledgeNodesBatch(familyId, body.source_document_id, body.nodes, { type: "workbuddy", id }));
    });
    app.post("/api/v2/knowledge-nodes/relations", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const body = request.body;
        return respond(reply.code(201), () => saveKnowledgeRelationsBatch(familyId, body.source_document_id, body.relations, { type: "workbuddy", id }));
    });
    app.get("/api/v2/children/:childId/knowledge/:nodeId/context", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId, nodeId } = request.params;
        return getKnowledgeContext(familyId, childId, nodeId);
    });
    app.put("/api/v2/children/:childId/knowledge/:nodeId/state", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { childId, nodeId } = request.params;
        const body = request.body;
        return respond(reply, () => upsertChildKnowledgeState(familyId, {
            childId,
            knowledgeNodeId: nodeId,
            status: body.status,
            score: body.score,
            evidence: body.evidence,
            manualReason: body.manual_reason,
        }, { type: "workbuddy", id }));
    });
    app.get("/api/v2/education-methods", auth, async (request) => {
        await ensureEducationMethods();
        return listEducationMethods(request.query);
    });
    app.get("/api/v2/children/:childId/relationship", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        return getLatestRelationship(familyId, childId);
    });
    app.get("/api/v2/children/:childId/relationship/history", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        const { limit, offset } = request.query;
        return listRelationshipHistory(familyId, childId, limit, offset);
    });
    app.post("/api/v2/children/:childId/relationship/snapshots", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { childId } = request.params;
        const body = request.body;
        return respond(reply.code(201), () => saveRelationshipSnapshot(familyId, {
            childId,
            status: body.status,
            score: body.score,
            communicationNote: body.communication_note,
            conflictCount: body.conflict_count,
            parentAction: body.parent_action,
            evidence: body.evidence,
        }, { type: "workbuddy", id }));
    });
    app.post("/api/v2/method-effects", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const body = request.body;
        return respond(reply.code(201), () => saveMethodEffect(familyId, {
            childId: body.child_id,
            methodId: body.method_id,
            goalId: body.goal_id,
            outcome: body.outcome,
            context: body.context,
            confidence: body.confidence,
            evidenceRef: body.evidence_ref,
        }, { type: "workbuddy", id }));
    });
    // ---- 学习决策层：学习优先级、信号、知识关联、待规划事项、推荐效果 ----
    app.get("/api/v2/children/:childId/learning-priorities", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        const query = request.query;
        return getLearningPriorities(familyId, childId, { limit: query.limit ? Number(query.limit) : undefined });
    });
    app.get("/api/v2/children/:childId/learning-signals", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { childId } = request.params;
        const query = request.query;
        if (query.refresh === "false")
            return syncLearningSignals(familyId, childId, new Date());
        return syncLearningSignals(familyId, childId);
    });
    app.post("/api/v2/learning-signals/:signalId/resolve", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { signalId } = request.params;
        const body = request.body;
        return resolveLearningSignal(familyId, signalId, { status: body?.status, note: body?.note });
    });
    app.get("/api/v2/question-types/:questionTypeId/knowledge-nodes", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionTypeId } = request.params;
        return listQuestionTypeKnowledgeNodes(familyId, questionTypeId);
    });
    app.post("/api/v2/question-types/:questionTypeId/knowledge-nodes", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionTypeId } = request.params;
        const body = request.body;
        return linkQuestionTypeKnowledgeNodes(familyId, questionTypeId, body?.links || []);
    });
    app.delete("/api/v2/question-types/:questionTypeId/knowledge-nodes/:knowledgeNodeId", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionTypeId, knowledgeNodeId } = request.params;
        return unlinkQuestionTypeKnowledgeNode(familyId, questionTypeId, knowledgeNodeId);
    });
    app.get("/api/v2/questions/:questionId/knowledge-nodes", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionId } = request.params;
        return listQuestionKnowledgeNodes(familyId, questionId);
    });
    app.post("/api/v2/questions/:questionId/knowledge-nodes", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionId } = request.params;
        const body = request.body;
        return linkQuestionKnowledgeNodes(familyId, questionId, body?.links || []);
    });
    app.post("/api/v2/questions/:questionId/verify-answer", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { questionId } = request.params;
        return verifyStoredQuestion(familyId, questionId);
    });
    app.get("/api/v2/planning-requests", auth, async (request) => {
        const { familyId } = getAuth(request);
        const query = request.query;
        return listPlanningRequests(familyId, {
            child_id: query.child_id,
            status: query.status,
            limit: query.limit ? Number(query.limit) : undefined,
        });
    });
    app.post("/api/v2/planning-requests", auth, async (request, reply) => {
        const { familyId } = getAuth(request);
        const body = request.body;
        const created = await ensurePlanningRequest(familyId, body?.child_id);
        if (!created)
            return reply.code(200).send({ created: false, reason: "当前没有达到需要重新规划的阈值" });
        return reply.code(201).send({ created: true, planning_request: created });
    });
    app.get("/api/v2/planning-requests/:planningRequestId", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { planningRequestId } = request.params;
        return getPlanningRequest(familyId, planningRequestId);
    });
    app.patch("/api/v2/planning-requests/:planningRequestId", auth, async (request) => {
        const { familyId } = getAuth(request);
        const { planningRequestId } = request.params;
        const body = request.body;
        return updatePlanningRequestStatus(familyId, planningRequestId, {
            status: body?.status,
            stage_goal_id: body?.stage_goal_id,
            note: body?.note,
        });
    });
    app.post("/api/v2/planning-requests/:planningRequestId/generate-ai", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { planningRequestId } = request.params;
        return respond(reply, () => generateAiPlanDraft(familyId, planningRequestId, { type: "system_ai", id }));
    });
    app.post("/api/v2/planning-requests/:planningRequestId/confirm-ai", auth, async (request, reply) => {
        const { familyId, id } = getAuth(request);
        const { planningRequestId } = request.params;
        return respond(reply, () => confirmAiPlanDraft(familyId, planningRequestId, { type: "parent", id }));
    });
    app.get("/api/v2/recommendation-outcomes", auth, async (request) => {
        const { familyId } = getAuth(request);
        const query = request.query;
        return listRecommendationOutcomes(familyId, {
            child_id: query.child_id,
            source_type: query.source_type,
            source_id: query.source_id,
            limit: query.limit ? Number(query.limit) : undefined,
        });
    });
    app.post("/api/v2/recommendation-outcomes", auth, async (request, reply) => {
        const { familyId } = getAuth(request);
        const body = request.body;
        return respond(reply.code(201), () => recordRecommendationOutcome(familyId, {
            child_id: body?.child_id,
            source_type: body?.source_type,
            source_id: body?.source_id,
            action_type: body?.action_type,
            status: body?.status,
            metrics: body?.metrics,
            note: body?.note,
            measured_at: body?.measured_at,
        }));
    });
}
