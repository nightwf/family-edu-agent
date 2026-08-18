import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { hashPassword, verifyPassword, createRefreshTokenHash, hashRefreshToken } from "./auth.js";
import { registerMcpHttp } from "./mcp.js";
import { buildWorkbuddyPrompt } from "./workbuddy-prompt.js";
import { saveFile } from "./storage.js";
import { getOrCreateFamilyMcpToken } from "./mcp-token.js";
import {
  listFamilyPolicies,
  getEffectiveSkill,
  updateFamilyProfile,
  getPolicyHistory,
  reviewPolicyChange,
  getFamilyEducationSettings,
  updateFamilyEducationSettings,
} from "./personalization.js";
import { recommendEducationMethods, EDUCATION_METHODS } from "./education-methods.js";
import { registerQuestionBankRoutes } from "./question-bank-routes.js";

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (_error) {
    return reply.code(401).send({ error: "未登录或登录已过期" });
  }
}

function getAuth(request: FastifyRequest) {
  const payload = (request as any).user as { sub: string; familyId: string };
  return { id: payload.sub, familyId: payload.familyId };
}

export async function buildApp() {
  const app: FastifyInstance = Fastify({ logger: true });
  const ownsResource = async (familyId: string, modelName: string, id: string) => {
    const model = (prisma as any)[modelName];
    return Boolean(await model.findFirst({ where: { id, familyId }, select: { id: true } }));
  };

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart, { attachFieldsToBody: true });
  await app.register(fastifyStatic, { root: path.resolve(process.cwd(), env.WEB_DIST), prefix: "/" });

  app.get("/api/health", async () => ({ ok: true, service: "family-edu-agent" }));

  app.post("/api/auth/register", async (request, reply) => {
    const { inviteCode, email, password } = request.body as any;
    if (!env.INVITE_CODES.has(String(inviteCode || "").trim())) {
      return reply.code(400).send({ error: "邀请码无效" });
    }
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || String(password || "").length < 6) {
      return reply.code(400).send({ error: "请填写有效邮箱和至少 6 位密码" });
    }
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.code(409).send({ error: "该邮箱已注册" });

    const family = await prisma.family.create({
      data: { name: "我的家庭", inviteCode: String(inviteCode).trim() },
    });
    const user = await prisma.user.create({
      data: {
        familyId: family.id,
        email: normalizedEmail,
        passwordHash: await hashPassword(String(password)),
      },
    });
    const token = app.jwt.sign({ sub: user.id, familyId: user.familyId });
    return reply.code(201).send({ token, user, family });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body as any;
    const user = await prisma.user.findUnique({ where: { email: String(email || "").trim().toLowerCase() } });
    if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
      return reply.code(401).send({ error: "邮箱或密码错误" });
    }
    const refresh = createRefreshTokenHash();
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const family = await prisma.family.findUnique({ where: { id: user.familyId } });
    const token = app.jwt.sign({ sub: user.id, familyId: user.familyId });
    return { token, refreshToken: refresh.token, user, family };
  });

  app.post("/api/auth/logout", { preHandler: requireAuth as any }, async (request) => {
    await prisma.session.updateMany({
      where: { userId: getAuth(request).id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });

  app.post("/api/auth/refresh", async (request, reply) => {
    const { refreshToken } = request.body as any;
    if (!refreshToken) return reply.code(400).send({ error: "缺少 refreshToken" });
    const session = await prisma.session.findFirst({
      where: {
        refreshTokenHash: hashRefreshToken(String(refreshToken)),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (!session) return reply.code(401).send({ error: "refreshToken 无效或已过期" });
    const token = app.jwt.sign({ sub: session.user.id, familyId: session.user.familyId });
    return { token };
  });

  app.get("/api/auth/me", { preHandler: requireAuth as any }, async (request) => {
    const auth = getAuth(request);
    const [user, family] = await Promise.all([
      prisma.user.findUnique({ where: { id: auth.id } }),
      prisma.family.findUnique({ where: { id: auth.familyId } }),
    ]);
    return { user, family };
  });

  app.get("/api/home", { preHandler: requireAuth as any }, async (request) => {
    const familyId = getAuth(request).familyId;
    const [children, reports, textbooks, knowledge, homework, records] = await Promise.all([
      prisma.child.findMany({ where: { familyId, status: "active" }, orderBy: { createdAt: "asc" } }),
      prisma.report.findMany({ where: { familyId }, orderBy: { createdAt: "desc" }, take: 3 }),
      prisma.textbook.findMany({ where: { familyId }, orderBy: { createdAt: "desc" } }),
      prisma.knowledgeItem.findMany({ where: { familyId }, orderBy: { createdAt: "desc" } }),
      prisma.homework.findMany({ where: { familyId }, orderBy: { dueDate: "asc" } }),
      prisma.record.findMany({ where: { familyId }, orderBy: { date: "desc" } }),
    ]);
    return {
      children,
      reports,
      textbooks,
      knowledge,
      homework,
      stats: {
        records: records.length,
        writing: records.filter((item) => item.type === "writing").length,
        reading: Math.round(records.filter((item) => item.type === "reading").reduce((sum, item) => sum + (item.score || 0), 0) / Math.max(1, records.filter((item) => item.type === "reading").length)),
        homework: Math.round(records.filter((item) => item.type === "homework").reduce((sum, item) => sum + (item.score || 0), 0) / Math.max(1, records.filter((item) => item.type === "homework").length)),
      },
    };
  });

  app.get("/api/children", { preHandler: requireAuth as any }, async (request) => {
    return prisma.child.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "asc" } });
  });

  app.post("/api/children", { preHandler: requireAuth as any }, async (request) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
    return prisma.child.create({
      data: {
        familyId,
        name: body.name,
        age: Number(body.age || 0),
        grade: body.grade,
        subjects: Array.isArray(body.subjects) ? body.subjects : String(body.subjects || "").split(/[,，]/).map((item: string) => item.trim()).filter(Boolean),
        textbookVersion: body.textbook_version || "",
      },
    });
  });

  app.patch("/api/children/:childId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { childId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "child", childId))) return reply.code(404).send({ error: "学生不存在" });
    const body = request.body as any;
    return prisma.child.update({
      where: { id: childId },
      data: {
        name: body.name,
        age: Number(body.age || 0),
        grade: body.grade,
        subjects: Array.isArray(body.subjects) ? body.subjects : String(body.subjects || "").split(/[,，]/).map((item: string) => item.trim()).filter(Boolean),
        textbookVersion: body.textbook_version || "",
      },
    });
  });

  app.delete("/api/children/:childId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { childId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "child", childId))) return reply.code(404).send({ error: "学生不存在" });
    await prisma.child.delete({ where: { id: childId } });
    return reply.send({ ok: true });
  });

  app.get("/api/children/:childId/records", { preHandler: requireAuth as any }, async (request) => {
    const { childId } = request.params as any;
    return prisma.record.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { date: "desc" } });
  });

  app.get("/api/children/:childId/reports", { preHandler: requireAuth as any }, async (request) => {
    const { childId } = request.params as any;
    return prisma.report.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
  });

  app.get("/api/children/:childId/growth", { preHandler: requireAuth as any }, async (request) => {
    const { childId } = request.params as any;
    const records = await prisma.record.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { date: "asc" } });
    return records.map((record) => ({
      date: record.date.toISOString().slice(0, 10),
      type: record.type,
      score: record.score,
    }));
  });

  app.get("/api/knowledge", { preHandler: requireAuth as any }, async (request) => {
    return prisma.knowledgeItem.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/api/knowledge", { preHandler: requireAuth as any }, async (request, reply) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
    if (!(await ownsResource(familyId, "child", body.child_id))) return reply.code(404).send({ error: "学生不存在" });
    return prisma.knowledgeItem.create({
      data: {
        familyId,
        childId: body.child_id,
        kind: body.kind || "summary",
        title: body.title,
        content: body.content,
        source: body.source || "workbuddy",
      },
    });
  });

  app.delete("/api/knowledge/:itemId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { itemId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "knowledgeItem", itemId))) return reply.code(404).send({ error: "知识库内容不存在" });
    await prisma.knowledgeItem.delete({ where: { id: itemId } });
    return { ok: true };
  });

  app.get("/api/homework", { preHandler: requireAuth as any }, async (request) => {
    return prisma.homework.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { dueDate: "asc" } });
  });

  app.post("/api/homework", { preHandler: requireAuth as any }, async (request, reply) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
    if (!(await ownsResource(familyId, "child", body.child_id))) return reply.code(404).send({ error: "学生不存在" });
    return prisma.homework.create({
      data: {
        familyId,
        childId: body.child_id,
        subject: body.subject,
        title: body.title,
        description: body.description,
        estimatedMinutes: Number(body.estimated_minutes || 0),
        priority: body.priority || "medium",
        dueDate: body.due_date ? new Date(body.due_date) : null,
        status: body.status || "pending",
      },
    });
  });

  app.post("/api/homework/:homeworkId/complete", { preHandler: requireAuth as any }, async (request, reply) => {
    const { homeworkId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "homework", homeworkId))) return reply.code(404).send({ error: "作业不存在" });
    return prisma.homework.update({ where: { id: homeworkId }, data: { status: "done", completedAt: new Date() } });
  });

  app.patch("/api/homework/:homeworkId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { homeworkId } = request.params as any;
    const body = request.body as any;
    const familyId = getAuth(request).familyId;
    if (!(await ownsResource(familyId, "homework", homeworkId))) return reply.code(404).send({ error: "作业不存在" });
    if (body.childId && !(await ownsResource(familyId, "child", body.childId))) return reply.code(404).send({ error: "学生不存在" });
    const { id: _id, familyId: _familyId, family: _family, child: _child, ...safeBody } = body;
    return prisma.homework.update({ where: { id: homeworkId }, data: safeBody });
  });

  app.delete("/api/homework/:homeworkId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { homeworkId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "homework", homeworkId))) return reply.code(404).send({ error: "作业不存在" });
    await prisma.homework.delete({ where: { id: homeworkId } });
    return { ok: true };
  });

  app.get("/api/textbooks", { preHandler: requireAuth as any }, async (request) => {
    return prisma.textbook.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/api/textbooks", { preHandler: requireAuth as any }, async (request, reply) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
    if (!(await ownsResource(familyId, "child", body.child_id))) return reply.code(404).send({ error: "学生不存在" });
    return prisma.textbook.create({
      data: {
        familyId,
        childId: body.child_id,
        title: body.title,
        subject: body.subject,
        grade: body.grade,
        publisher: body.publisher,
        version: body.version,
        source: body.source || "workbuddy",
        fileKey: body.file_key || "",
        knowledgePoints: Array.isArray(body.knowledge_points) ? body.knowledge_points : [],
      },
    });
  });

  app.post("/api/textbooks/upload", { preHandler: requireAuth as any }, async (request, reply) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
    const filePart = body.file;
    if (!filePart || typeof filePart.toBuffer !== "function") return reply.code(400).send({ error: "缺少教材文件" });
    const buffer = await filePart.toBuffer();
    const filename = filePart.filename || "textbook";
    const mimetype = filePart.mimetype || "application/octet-stream";
    const value = (key: string) => body[key]?.value ?? body[key] ?? (request.query as any)?.[key] ?? "";
    const childId = String(value("child_id"));
    if (!(await ownsResource(familyId, "child", childId))) return reply.code(404).send({ error: "学生不存在" });
    const key = `textbooks/${familyId}/${crypto.randomUUID()}-${filename}`;
    const fileKey = await saveFile(key, buffer, mimetype);
    return prisma.textbook.create({
      data: {
        familyId,
        childId,
        title: String(value("title") || filename),
        subject: String(value("subject") || ""),
        grade: String(value("grade") || ""),
        publisher: String(value("publisher") || ""),
        version: String(value("version") || ""),
        fileKey,
        knowledgePoints: [],
      },
    });
  });

  app.patch("/api/textbooks/:textbookId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { textbookId } = request.params as any;
    const body = request.body as any;
    const familyId = getAuth(request).familyId;
    if (!(await ownsResource(familyId, "textbook", textbookId))) return reply.code(404).send({ error: "教材不存在" });
    if (body.childId && !(await ownsResource(familyId, "child", body.childId))) return reply.code(404).send({ error: "学生不存在" });
    const { id: _id, familyId: _familyId, family: _family, child: _child, ...safeBody } = body;
    return prisma.textbook.update({ where: { id: textbookId }, data: safeBody });
  });

  app.delete("/api/textbooks/:textbookId", { preHandler: requireAuth as any }, async (request, reply) => {
    const { textbookId } = request.params as any;
    if (!(await ownsResource(getAuth(request).familyId, "textbook", textbookId))) return reply.code(404).send({ error: "教材不存在" });
    await prisma.textbook.delete({ where: { id: textbookId } });
    return { ok: true };
  });

  app.get("/api/settings", { preHandler: requireAuth as any }, async (request) => {
    const auth = getAuth(request);
    const [user, family, childCount, mcpToken] = await Promise.all([
      prisma.user.findUnique({ where: { id: auth.id } }),
      prisma.family.findUnique({ where: { id: auth.familyId } }),
      prisma.child.count({ where: { familyId: auth.familyId } }),
      getOrCreateFamilyMcpToken(auth.familyId),
    ]);
    return {
      user,
      family,
      child_count: childCount,
      mcp_token: mcpToken,
      workbuddy_prompt: mcpToken ? buildWorkbuddyPrompt(mcpToken) : "",
    };
  });

  app.get("/api/policies", { preHandler: requireAuth as any }, async (request) => {
    return listFamilyPolicies(getAuth(request).familyId);
  });

  app.get("/api/policies/:skillId/effective", { preHandler: requireAuth as any }, async (request) => {
    const { skillId } = request.params as any;
    const effective = await getEffectiveSkill(getAuth(request).familyId, skillId);
    if (!effective) return { error: "skill not found" };
    return effective;
  });

  app.patch("/api/policies/:skillId", { preHandler: requireAuth as any }, async (request) => {
    const { skillId } = request.params as any;
    const body = request.body as any;
    return updateFamilyProfile(getAuth(request).familyId, skillId, {
      philosophy: body.philosophy,
      communicationStyle: body.communication_style,
      strictness: body.strictness,
      parentGoals: Array.isArray(body.parent_goals) ? body.parent_goals : body.parent_goals ? String(body.parent_goals).split(/[,，]/).map((item: string) => item.trim()).filter(Boolean) : undefined,
    });
  });

  app.get("/api/policy-changes", { preHandler: requireAuth as any }, async (request) => {
    return getPolicyHistory(getAuth(request).familyId);
  });

  app.get("/api/education-settings", { preHandler: requireAuth as any }, async (request) => {
    return getFamilyEducationSettings(getAuth(request).familyId);
  });

  app.patch("/api/education-settings", { preHandler: requireAuth as any }, async (request) => {
    const body = request.body as any;
    return updateFamilyEducationSettings(getAuth(request).familyId, {
      educationPhilosophy: body.education_philosophy,
      communicationStyle: body.communication_style,
      strictness: body.strictness,
      parentGoals: Array.isArray(body.parent_goals) ? body.parent_goals : body.parent_goals ? String(body.parent_goals).split(/[,，]/).map((item: string) => item.trim()).filter(Boolean) : undefined,
    });
  });

  app.get("/api/education-methods", { preHandler: requireAuth as any }, async (request) => {
    const family = await getFamilyEducationSettings(getAuth(request).familyId);
    return {
      available: EDUCATION_METHODS,
      recommended: recommendEducationMethods({
        educationPhilosophy: family?.educationPhilosophy,
        strictness: family?.strictness,
        communicationStyle: family?.communicationStyle,
      }),
    };
  });

  app.post("/api/policy-changes/:changeId/review", { preHandler: requireAuth as any }, async (request, reply) => {
    const { changeId } = request.params as any;
    const { action } = request.body as any;
    if (!(await ownsResource(getAuth(request).familyId, "policyChange", changeId))) return reply.code(404).send({ error: "优化建议不存在" });
    return reviewPolicyChange(changeId, action);
  });

  registerQuestionBankRoutes(app, requireAuth, (request) => getAuth(request).familyId);

  await registerMcpHttp(app);

  app.setNotFoundHandler((request, reply) => {
    if (!request.url.startsWith("/api") && !request.url.startsWith("/mcp")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not found" });
  });

  return app;
}
