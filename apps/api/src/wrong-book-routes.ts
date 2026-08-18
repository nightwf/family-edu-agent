import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { QuestionBankError } from "./question-bank.js";
import {
  createPracticePaper,
  deletePracticePaper,
  deleteRemediationPlan,
  deleteWrongQuestion,
  getPracticePaper,
  getRemediationPlan,
  getWrongQuestion,
  getWrongQuestionPracticeContext,
  listPracticePapers,
  listRemediationPlans,
  listWrongQuestions,
  recalculateWrongQuestionMastery,
  saveRemediationPlan,
  saveWrongQuestion,
  updatePracticePaper,
  updateRemediationPlan,
  updateRemediationTaskStatus,
  updateWrongQuestion,
  updateWrongQuestionStatus,
} from "./wrong-book.js";

async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof QuestionBankError) return reply.code(error.statusCode).send({ error: error.message });
    throw error;
  }
}

export function registerWrongBookRoutes(
  app: FastifyInstance,
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  getFamilyId: (request: FastifyRequest) => string,
) {
  const auth = { preHandler: requireAuth as any };

  app.get("/api/wrong-questions", auth, async (request, reply) => respond(reply, () => listWrongQuestions(getFamilyId(request), request.query as any)));
  app.post("/api/wrong-questions", auth, async (request, reply) => respond(reply.code(201), () => saveWrongQuestion(getFamilyId(request), request.body as any)));
  app.post("/api/wrong-questions/practice-context", auth, async (request, reply) => respond(reply, () => getWrongQuestionPracticeContext(getFamilyId(request), request.body as any)));
  app.get("/api/wrong-questions/:wrongQuestionId", auth, async (request, reply) => {
    const { wrongQuestionId } = request.params as any;
    return respond(reply, () => getWrongQuestion(getFamilyId(request), wrongQuestionId));
  });
  app.patch("/api/wrong-questions/:wrongQuestionId", auth, async (request, reply) => {
    const { wrongQuestionId } = request.params as any;
    return respond(reply, () => updateWrongQuestion(getFamilyId(request), wrongQuestionId, request.body as any));
  });
  app.patch("/api/wrong-questions/:wrongQuestionId/status", auth, async (request, reply) => {
    const { wrongQuestionId } = request.params as any;
    return respond(reply, () => updateWrongQuestionStatus(getFamilyId(request), wrongQuestionId, request.body as any));
  });
  app.post("/api/wrong-questions/:wrongQuestionId/recalculate", auth, async (request, reply) => {
    const { wrongQuestionId } = request.params as any;
    return respond(reply, () => recalculateWrongQuestionMastery(getFamilyId(request), wrongQuestionId));
  });
  app.delete("/api/wrong-questions/:wrongQuestionId", auth, async (request, reply) => {
    const { wrongQuestionId } = request.params as any;
    return respond(reply, () => deleteWrongQuestion(getFamilyId(request), wrongQuestionId));
  });

  app.get("/api/practice-papers", auth, async (request, reply) => respond(reply, () => listPracticePapers(getFamilyId(request), request.query as any)));
  app.post("/api/practice-papers", auth, async (request, reply) => respond(reply.code(201), () => createPracticePaper(getFamilyId(request), request.body as any)));
  app.get("/api/practice-papers/:practicePaperId", auth, async (request, reply) => {
    const { practicePaperId } = request.params as any;
    return respond(reply, () => getPracticePaper(getFamilyId(request), practicePaperId));
  });
  app.patch("/api/practice-papers/:practicePaperId", auth, async (request, reply) => {
    const { practicePaperId } = request.params as any;
    return respond(reply, () => updatePracticePaper(getFamilyId(request), practicePaperId, request.body as any));
  });
  app.delete("/api/practice-papers/:practicePaperId", auth, async (request, reply) => {
    const { practicePaperId } = request.params as any;
    return respond(reply, () => deletePracticePaper(getFamilyId(request), practicePaperId));
  });

  app.get("/api/remediation-plans", auth, async (request, reply) => respond(reply, () => listRemediationPlans(getFamilyId(request), request.query as any)));
  app.post("/api/remediation-plans", auth, async (request, reply) => respond(reply.code(201), () => saveRemediationPlan(getFamilyId(request), request.body as any)));
  app.get("/api/remediation-plans/:remediationPlanId", auth, async (request, reply) => {
    const { remediationPlanId } = request.params as any;
    return respond(reply, () => getRemediationPlan(getFamilyId(request), remediationPlanId));
  });
  app.patch("/api/remediation-plans/:remediationPlanId", auth, async (request, reply) => {
    const { remediationPlanId } = request.params as any;
    return respond(reply, () => updateRemediationPlan(getFamilyId(request), remediationPlanId, request.body as any));
  });
  app.patch("/api/remediation-plans/:remediationPlanId/tasks/:taskId/status", auth, async (request, reply) => {
    const { remediationPlanId, taskId } = request.params as any;
    return respond(reply, () => updateRemediationTaskStatus(getFamilyId(request), remediationPlanId, taskId, request.body as any));
  });
  app.delete("/api/remediation-plans/:remediationPlanId", auth, async (request, reply) => {
    const { remediationPlanId } = request.params as any;
    return respond(reply, () => deleteRemediationPlan(getFamilyId(request), remediationPlanId));
  });
}
