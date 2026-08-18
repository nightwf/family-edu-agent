import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { openFile, saveFile } from "./storage.js";
import {
  QuestionBankError,
  createQuestion,
  createQuestionsBatch,
  createQuestionType,
  deleteQuestion,
  deleteQuestionType,
  getQuestion,
  getQuestionGenerationContext,
  getQuestionType,
  getStudentMastery,
  listQuestionAttempts,
  listQuestions,
  listQuestionTypes,
  listStudentMastery,
  recalculateMastery,
  updateMasteryOverride,
  updateQuestion,
  updateQuestionType,
} from "./question-bank.js";
import { recordQuestionAttemptWithWrongBook } from "./wrong-book.js";

const DEFAULT_SUBJECTS = ["数学", "语文", "英语", "科学", "地理", "物理", "化学", "其他"];

async function respond(reply: FastifyReply, action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof QuestionBankError) return reply.code(error.statusCode).send({ error: error.message });
    throw error;
  }
}

export function registerQuestionBankRoutes(
  app: FastifyInstance,
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  getFamilyId: (request: FastifyRequest) => string,
) {
  const auth = { preHandler: requireAuth as any };

  app.get("/api/question-subjects", auth, async (request) => {
    const familyId = getFamilyId(request);
    const subjects = await prisma.questionType.findMany({ where: { familyId }, distinct: ["subject"], select: { subject: true } });
    return [...new Set([...DEFAULT_SUBJECTS, ...subjects.map((item) => item.subject)])];
  });

  app.get("/api/question-types", auth, async (request, reply) => respond(reply, () => listQuestionTypes(getFamilyId(request), request.query as any)));
  app.post("/api/question-types", auth, async (request, reply) => respond(reply.code(201), () => createQuestionType(getFamilyId(request), request.body as any)));
  app.get("/api/question-types/:questionTypeId", auth, async (request, reply) => {
    const { questionTypeId } = request.params as any;
    return respond(reply, () => getQuestionType(getFamilyId(request), questionTypeId));
  });
  app.patch("/api/question-types/:questionTypeId", auth, async (request, reply) => {
    const { questionTypeId } = request.params as any;
    return respond(reply, () => updateQuestionType(getFamilyId(request), questionTypeId, request.body as any));
  });
  app.delete("/api/question-types/:questionTypeId", auth, async (request, reply) => {
    const { questionTypeId } = request.params as any;
    return respond(reply, () => deleteQuestionType(getFamilyId(request), questionTypeId));
  });

  app.get("/api/questions", auth, async (request, reply) => respond(reply, () => listQuestions(getFamilyId(request), request.query as any)));
  app.post("/api/questions", auth, async (request, reply) => respond(reply.code(201), () => createQuestion(getFamilyId(request), request.body as any)));
  app.post("/api/questions/batch", auth, async (request, reply) => {
    const body = request.body as any;
    return respond(reply.code(201), () => createQuestionsBatch(getFamilyId(request), body?.questions));
  });
  app.post("/api/questions/upload", auth, async (request, reply) => {
    const familyId = getFamilyId(request);
    const body = request.body as any;
    const filePart = body?.file;
    if (!filePart || typeof filePart.toBuffer !== "function") return reply.code(400).send({ error: "缺少题目附件" });
    const buffer = await filePart.toBuffer();
    if (buffer.length > 15 * 1024 * 1024) return reply.code(400).send({ error: "题目附件不能超过 15MB" });
    const filename = filePart.filename || "question-file";
    const mimetype = filePart.mimetype || "application/octet-stream";
    const key = `questions/${familyId}/${crypto.randomUUID()}-${filename}`;
    return { file_key: await saveFile(key, buffer, mimetype), filename, content_type: mimetype };
  });
  app.post("/api/question-generation-context", auth, async (request, reply) => respond(reply, () => getQuestionGenerationContext(getFamilyId(request), request.body as any)));
  app.get("/api/questions/:questionId/file", auth, async (request, reply) => {
    const { questionId } = request.params as any;
    return respond(reply, async () => {
      const question = await getQuestion(getFamilyId(request), questionId);
      if (!question?.fileKey) throw new QuestionBankError("该题目没有附件", 404);
      const extension = question.fileKey.split(".").pop()?.toLowerCase();
      const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" };
      reply.header("Content-Type", contentTypes[extension || ""] || "application/octet-stream");
      reply.header("Content-Disposition", "inline");
      return reply.send(await openFile(question.fileKey));
    });
  });
  app.get("/api/questions/:questionId", auth, async (request, reply) => {
    const { questionId } = request.params as any;
    return respond(reply, () => getQuestion(getFamilyId(request), questionId));
  });
  app.patch("/api/questions/:questionId", auth, async (request, reply) => {
    const { questionId } = request.params as any;
    return respond(reply, () => updateQuestion(getFamilyId(request), questionId, request.body as any));
  });
  app.delete("/api/questions/:questionId", auth, async (request, reply) => {
    const { questionId } = request.params as any;
    return respond(reply, () => deleteQuestion(getFamilyId(request), questionId));
  });

  app.get("/api/question-attempts", auth, async (request, reply) => respond(reply, () => listQuestionAttempts(getFamilyId(request), request.query as any)));
  app.post("/api/question-attempts", auth, async (request, reply) => respond(reply.code(201), () => recordQuestionAttemptWithWrongBook(getFamilyId(request), request.body as any)));

  app.get("/api/mastery", auth, async (request, reply) => respond(reply, () => listStudentMastery(getFamilyId(request), request.query as any)));
  app.get("/api/mastery/:childId/:questionTypeId", auth, async (request, reply) => {
    const { childId, questionTypeId } = request.params as any;
    return respond(reply, () => getStudentMastery(getFamilyId(request), childId, questionTypeId));
  });
  app.patch("/api/mastery/:childId/:questionTypeId", auth, async (request, reply) => {
    const { childId, questionTypeId } = request.params as any;
    return respond(reply, () => updateMasteryOverride(getFamilyId(request), childId, questionTypeId, request.body as any));
  });
  app.post("/api/mastery/:childId/:questionTypeId/recalculate", auth, async (request, reply) => {
    const { childId, questionTypeId } = request.params as any;
    return respond(reply, () => recalculateMastery(getFamilyId(request), childId, questionTypeId));
  });
}
