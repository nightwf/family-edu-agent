import Fastify from "fastify";
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
import { WORKBUDDY_PROMPT } from "./workbuddy-prompt.js";
import { saveFile } from "./storage.js";
async function requireAuth(request, reply) {
    try {
        await request.jwtVerify();
    }
    catch (_error) {
        return reply.code(401).send({ error: "未登录或登录已过期" });
    }
}
function getAuth(request) {
    const payload = request.user;
    return { id: payload.sub, familyId: payload.familyId };
}
export async function buildApp() {
    const app = Fastify({ logger: true });
    await app.register(cors, { origin: true });
    await app.register(jwt, { secret: env.JWT_SECRET });
    await app.register(multipart, { attachFieldsToBody: true });
    await app.register(fastifyStatic, { root: path.resolve(process.cwd(), env.WEB_DIST), prefix: "/" });
    app.get("/api/health", async () => ({ ok: true, service: "family-edu-agent" }));
    app.post("/api/auth/register", async (request, reply) => {
        const { inviteCode, email, password } = request.body;
        if (!env.INVITE_CODES.has(String(inviteCode || "").trim())) {
            return reply.code(400).send({ error: "邀请码无效" });
        }
        const normalizedEmail = String(email || "").trim().toLowerCase();
        if (!normalizedEmail || String(password || "").length < 6) {
            return reply.code(400).send({ error: "请填写有效邮箱和至少 6 位密码" });
        }
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing)
            return reply.code(409).send({ error: "该邮箱已注册" });
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
        const { email, password } = request.body;
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
    app.post("/api/auth/logout", { preHandler: requireAuth }, async (request) => {
        await prisma.session.updateMany({
            where: { userId: getAuth(request).id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return { ok: true };
    });
    app.post("/api/auth/refresh", async (request, reply) => {
        const { refreshToken } = request.body;
        if (!refreshToken)
            return reply.code(400).send({ error: "缺少 refreshToken" });
        const session = await prisma.session.findFirst({
            where: {
                refreshTokenHash: hashRefreshToken(String(refreshToken)),
                revokedAt: null,
                expiresAt: { gt: new Date() },
            },
            include: { user: true },
        });
        if (!session)
            return reply.code(401).send({ error: "refreshToken 无效或已过期" });
        const token = app.jwt.sign({ sub: session.user.id, familyId: session.user.familyId });
        return { token };
    });
    app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const [user, family] = await Promise.all([
            prisma.user.findUnique({ where: { id: auth.id } }),
            prisma.family.findUnique({ where: { id: auth.familyId } }),
        ]);
        return { user, family };
    });
    app.get("/api/home", { preHandler: requireAuth }, async (request) => {
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
    app.get("/api/children", { preHandler: requireAuth }, async (request) => {
        return prisma.child.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "asc" } });
    });
    app.post("/api/children", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
        return prisma.child.create({
            data: {
                familyId,
                name: body.name,
                age: Number(body.age || 0),
                grade: body.grade,
                subjects: Array.isArray(body.subjects) ? body.subjects : String(body.subjects || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                textbookVersion: body.textbook_version || "",
            },
        });
    });
    app.patch("/api/children/:childId", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        const body = request.body;
        return prisma.child.update({
            where: { id: childId },
            data: {
                name: body.name,
                age: Number(body.age || 0),
                grade: body.grade,
                subjects: Array.isArray(body.subjects) ? body.subjects : String(body.subjects || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                textbookVersion: body.textbook_version || "",
            },
        });
    });
    app.delete("/api/children/:childId", { preHandler: requireAuth }, async (request, reply) => {
        const { childId } = request.params;
        await prisma.child.delete({ where: { id: childId } });
        return reply.send({ ok: true });
    });
    app.get("/api/children/:childId/records", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        return prisma.record.findMany({ where: { childId }, orderBy: { date: "desc" } });
    });
    app.get("/api/children/:childId/reports", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        return prisma.report.findMany({ where: { childId }, orderBy: { createdAt: "desc" } });
    });
    app.get("/api/children/:childId/growth", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        const records = await prisma.record.findMany({ where: { childId }, orderBy: { date: "asc" } });
        return records.map((record) => ({
            date: record.date.toISOString().slice(0, 10),
            type: record.type,
            score: record.score,
        }));
    });
    app.get("/api/knowledge", { preHandler: requireAuth }, async (request) => {
        return prisma.knowledgeItem.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
    });
    app.post("/api/knowledge", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
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
    app.delete("/api/knowledge/:itemId", { preHandler: requireAuth }, async (request) => {
        const { itemId } = request.params;
        await prisma.knowledgeItem.delete({ where: { id: itemId } });
        return { ok: true };
    });
    app.get("/api/homework", { preHandler: requireAuth }, async (request) => {
        return prisma.homework.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { dueDate: "asc" } });
    });
    app.post("/api/homework", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
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
    app.post("/api/homework/:homeworkId/complete", { preHandler: requireAuth }, async (request) => {
        const { homeworkId } = request.params;
        return prisma.homework.update({ where: { id: homeworkId }, data: { status: "done", completedAt: new Date() } });
    });
    app.get("/api/textbooks", { preHandler: requireAuth }, async (request) => {
        return prisma.textbook.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" } });
    });
    app.post("/api/textbooks", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
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
    app.post("/api/textbooks/upload", { preHandler: requireAuth }, async (request, reply) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
        const filePart = body.file;
        if (!filePart || typeof filePart.toBuffer !== "function")
            return reply.code(400).send({ error: "缺少教材文件" });
        const buffer = await filePart.toBuffer();
        const filename = filePart.filename || "textbook";
        const mimetype = filePart.mimetype || "application/octet-stream";
        const value = (key) => body[key]?.value ?? body[key] ?? request.query?.[key] ?? "";
        const key = `textbooks/${familyId}/${crypto.randomUUID()}-${filename}`;
        const fileKey = await saveFile(key, buffer, mimetype);
        return prisma.textbook.create({
            data: {
                familyId,
                childId: String(value("child_id")),
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
    app.patch("/api/textbooks/:textbookId", { preHandler: requireAuth }, async (request) => {
        const { textbookId } = request.params;
        const body = request.body;
        return prisma.textbook.update({ where: { id: textbookId }, data: body });
    });
    app.get("/api/settings", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const [user, family, childCount] = await Promise.all([
            prisma.user.findUnique({ where: { id: auth.id } }),
            prisma.family.findUnique({ where: { id: auth.familyId } }),
            prisma.child.count({ where: { familyId: auth.familyId } }),
        ]);
        return { user, family, child_count: childCount, workbuddy_prompt: WORKBUDDY_PROMPT };
    });
    await registerMcpHttp(app);
    app.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith("/api") && !request.url.startsWith("/mcp")) {
            return reply.sendFile("index.html");
        }
        return reply.code(404).send({ error: "not found" });
    });
    return app;
}
