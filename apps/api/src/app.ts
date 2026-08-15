import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { hashPassword, verifyPassword, createRefreshTokenHash } from "./auth.js";
import { registerMcpHttp } from "./mcp.js";

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

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart);
  await app.register(fastifyStatic, { root: path.resolve(process.cwd(), env.WEB_DIST), prefix: "/family-edu/" });

  app.get("/api/health", async () => ({ ok: true, service: "family-edu-agent" }));

  app.get("/family-edu/*", async (request, reply) => {
    return reply.sendFile("index.html");
  });

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

  app.patch("/api/children/:childId", { preHandler: requireAuth as any }, async (request) => {
    const { childId } = request.params as any;
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
    await prisma.child.delete({ where: { id: childId } });
    return reply.send({ ok: true });
  });

  app.get("/api/knowledge", { preHandler: requireAuth as any }, async (request) => {
    return prisma.knowledgeItem.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/api/knowledge", { preHandler: requireAuth as any }, async (request) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
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

  app.delete("/api/knowledge/:itemId", { preHandler: requireAuth as any }, async (request) => {
    const { itemId } = request.params as any;
    await prisma.knowledgeItem.delete({ where: { id: itemId } });
    return { ok: true };
  });

  app.get("/api/homework", { preHandler: requireAuth as any }, async (request) => {
    return prisma.homework.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { dueDate: "asc" } });
  });

  app.post("/api/homework", { preHandler: requireAuth as any }, async (request) => {
    const familyId = getAuth(request).familyId;
    const body = request.body as any;
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

  app.post("/api/homework/:homeworkId/complete", { preHandler: requireAuth as any }, async (request) => {
    const { homeworkId } = request.params as any;
    return prisma.homework.update({ where: { id: homeworkId }, data: { status: "done", completedAt: new Date() } });
  });

  app.get("/api/textbooks", { preHandler: requireAuth as any }, async (request) => {
    return prisma.textbook.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
  });

  app.patch("/api/textbooks/:textbookId", { preHandler: requireAuth as any }, async (request) => {
    const { textbookId } = request.params as any;
    const body = request.body as any;
    return prisma.textbook.update({ where: { id: textbookId }, data: body });
  });

  app.get("/api/settings", { preHandler: requireAuth as any }, async (request) => {
    const auth = getAuth(request);
    const [user, family, childCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: auth.id } }),
      prisma.family.findUnique({ where: { id: auth.familyId } }),
      prisma.child.count({ where: { familyId: auth.familyId } }),
    ]);
    return { user, family, child_count: childCount };
  });

  await registerMcpHttp(app);

  return app;
}
