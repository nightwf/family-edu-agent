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
import { buildDoubaoPrompt, buildWorkbuddyOpenPlatformConfig, buildWorkbuddyPrompt } from "./workbuddy-prompt.js";
import { saveFile } from "./storage.js";
import { getOrCreateFamilyMcpToken } from "./mcp-token.js";
import { listFamilyPolicies, getEffectiveSkill, updateFamilyProfile, getPolicyHistory, reviewPolicyChange, getFamilyEducationSettings, updateFamilyEducationSettings, } from "./personalization.js";
import { recommendEducationMethods, EDUCATION_METHODS } from "./education-methods.js";
import { listQuestions, listQuestionTypes, listStudentMastery } from "./question-bank.js";
import { listPracticePapers, listRemediationPlans, listWrongQuestions } from "./wrong-book.js";
import { registerQuestionBankRoutes } from "./question-bank-routes.js";
import { registerWrongBookRoutes } from "./wrong-book-routes.js";
import { registerV2Routes } from "./v2/routes.js";
import { exchangeWechatCode, WechatError } from "./wechat.js";
import { createInviteCode, ensureFamilyMember, getActiveFamilyMember, listFamilyMembers, listPendingInvites, normalizeEmail, requireOwner, } from "./family-members.js";
async function requireAuth(request, reply) {
    try {
        await request.jwtVerify();
        const payload = request.user;
        if (!payload?.sub || !payload?.familyId) {
            return reply.code(401).send({ error: "未登录或登录已过期" });
        }
        const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { familyId: true } });
        if (!user || user.familyId !== payload.familyId) {
            return reply.code(403).send({ error: "当前账号已切换家庭，请重新登录" });
        }
        const member = await getActiveFamilyMember(payload.familyId, payload.sub);
        if (!member) {
            await ensureFamilyMember(payload.familyId, payload.sub, "owner");
            return;
        }
    }
    catch (_error) {
        return reply.code(401).send({ error: "未登录或登录已过期" });
    }
}
async function createSessionResponse(app, user) {
    await ensureFamilyMember(user.familyId, user.id, "owner");
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
    const member = await getActiveFamilyMember(user.familyId, user.id);
    return { token, refreshToken: refresh.token, user, family, member };
}
function getAuth(request) {
    const payload = request.user;
    return { id: payload.sub, familyId: payload.familyId };
}
function pageValues(input = {}, defaultLimit = 20, maxLimit = 100) {
    const rawLimit = Number(input.limit || defaultLimit);
    const rawOffset = Number(input.offset || 0);
    const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    return { limit, offset };
}
async function getValidFamilyInvite(code) {
    if (!code)
        return null;
    if (!code.startsWith("HEYAFAM-"))
        return null;
    const invite = await prisma.familyInvite.findUnique({ where: { inviteCode: code } });
    if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now())
        return null;
    return invite;
}
async function acceptFamilyInvite(inviteId, userId) {
    const invite = await prisma.familyInvite.findUnique({ where: { id: inviteId } });
    if (!invite)
        return null;
    await ensureFamilyMember(invite.familyId, userId, invite.role === "owner" ? "owner" : "admin");
    await prisma.familyInvite.update({
        where: { id: invite.id },
        data: {
            status: "accepted",
            acceptedByUserId: userId,
            acceptedAt: new Date(),
        },
    });
    return invite;
}
export async function buildApp() {
    const app = Fastify({ logger: true });
    const ownsResource = async (familyId, modelName, id) => {
        const model = prisma[modelName];
        return Boolean(await model.findFirst({ where: { id, familyId }, select: { id: true } }));
    };
    await app.register(cors, { origin: true });
    await app.register(jwt, { secret: env.JWT_SECRET });
    await app.register(multipart, { attachFieldsToBody: true });
    await app.register(fastifyStatic, { root: path.resolve(process.cwd(), env.WEB_DIST), prefix: "/" });
    app.get("/api/health", async () => ({ ok: true, service: "family-edu-agent" }));
    app.post("/api/auth/register", async (request, reply) => {
        const { inviteCode, email, password } = request.body;
        const code = String(inviteCode || "").trim();
        const familyInvite = await getValidFamilyInvite(code);
        if (!familyInvite && !env.INVITE_CODES.has(code))
            return reply.code(400).send({ error: "邀请码无效" });
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || String(password || "").length < 6) {
            return reply.code(400).send({ error: "请填写有效邮箱和至少 6 位密码" });
        }
        if (familyInvite?.inviteEmail && familyInvite.inviteEmail !== normalizedEmail) {
            return reply.code(403).send({ error: "当前邮箱与家庭邀请对象不一致" });
        }
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing)
            return reply.code(409).send({ error: "该邮箱已注册" });
        const family = familyInvite
            ? await prisma.family.findUniqueOrThrow({ where: { id: familyInvite.familyId } })
            : await prisma.family.create({ data: { name: "我的家庭", inviteCode: code } });
        const user = await prisma.user.create({
            data: {
                familyId: family.id,
                email: normalizedEmail,
                passwordHash: await hashPassword(String(password)),
            },
        });
        if (familyInvite) {
            await acceptFamilyInvite(familyInvite.id, user.id);
        }
        else {
            await ensureFamilyMember(family.id, user.id, "owner");
        }
        return reply.code(201).send(await createSessionResponse(app, user));
    });
    app.post("/api/auth/login", async (request, reply) => {
        const { email, password } = request.body;
        const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
        if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
            return reply.code(401).send({ error: "邮箱或密码错误" });
        }
        return createSessionResponse(app, user);
    });
    app.post("/api/auth/wechat/login", async (request, reply) => {
        try {
            const { code } = request.body;
            if (!code)
                return reply.code(400).send({ error: "缺少微信登录 code" });
            const wechat = await exchangeWechatCode(String(code));
            const user = await prisma.user.findUnique({ where: { wechatOpenId: wechat.openid } });
            if (!user) {
                const bindToken = app.jwt.sign({ bind: "wechat", openid: wechat.openid, unionid: wechat.unionid || null }, { expiresIn: "10m" });
                return { need_bind: true, bind_token: bindToken, has_wechat_login: true };
            }
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    lastWechatLoginAt: new Date(),
                    wechatUnionId: wechat.unionid || user.wechatUnionId,
                },
            });
            return createSessionResponse(app, user);
        }
        catch (error) {
            if (error instanceof WechatError)
                return reply.code(error.statusCode).send({ error: error.message });
            throw error;
        }
    });
    app.post("/api/auth/wechat/bind", async (request, reply) => {
        try {
            const { bind_token: bindToken, mode, email, password, inviteCode } = request.body;
            if (!bindToken || !["existing", "register"].includes(mode)) {
                return reply.code(400).send({ error: "缺少有效的微信绑定参数" });
            }
            let payload;
            try {
                payload = app.jwt.verify(String(bindToken));
            }
            catch (_error) {
                return reply.code(401).send({ error: "微信绑定凭证已过期，请重新登录" });
            }
            if (!payload?.openid)
                return reply.code(400).send({ error: "微信绑定凭证无效" });
            if (mode === "existing") {
                const normalizedEmail = normalizeEmail(email);
                const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
                if (!user || !(await verifyPassword(String(password || ""), user.passwordHash))) {
                    return reply.code(401).send({ error: "邮箱或密码错误" });
                }
                if (user.wechatOpenId && user.wechatOpenId !== payload.openid) {
                    return reply.code(409).send({ error: "该账号已绑定其他微信" });
                }
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        wechatOpenId: payload.openid,
                        wechatUnionId: payload.unionid || user.wechatUnionId,
                        lastWechatLoginAt: new Date(),
                    },
                });
                return createSessionResponse(app, user);
            }
            const code = String(inviteCode || "").trim();
            const familyInvite = await getValidFamilyInvite(code);
            if (!familyInvite && !env.INVITE_CODES.has(code))
                return reply.code(400).send({ error: "邀请码无效" });
            const normalizedEmail = normalizeEmail(email);
            if (!normalizedEmail || String(password || "").length < 6) {
                return reply.code(400).send({ error: "请填写有效邮箱和至少 6 位密码" });
            }
            if (familyInvite?.inviteEmail && familyInvite.inviteEmail !== normalizedEmail) {
                return reply.code(403).send({ error: "当前邮箱与家庭邀请对象不一致" });
            }
            const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
            if (existing)
                return reply.code(409).send({ error: "该邮箱已注册" });
            const claimed = await prisma.user.findUnique({ where: { wechatOpenId: payload.openid } });
            if (claimed)
                return reply.code(409).send({ error: "该微信已绑定其他账号" });
            const family = familyInvite
                ? await prisma.family.findUniqueOrThrow({ where: { id: familyInvite.familyId } })
                : await prisma.family.create({ data: { name: "我的家庭", inviteCode: code } });
            const user = await prisma.user.create({
                data: {
                    familyId: family.id,
                    email: normalizedEmail,
                    passwordHash: await hashPassword(String(password)),
                    wechatOpenId: payload.openid,
                    wechatUnionId: payload.unionid || null,
                    lastWechatLoginAt: new Date(),
                },
            });
            if (familyInvite) {
                await acceptFamilyInvite(familyInvite.id, user.id);
            }
            else {
                await ensureFamilyMember(family.id, user.id, "owner");
            }
            return createSessionResponse(app, user);
        }
        catch (error) {
            if (error instanceof WechatError)
                return reply.code(error.statusCode).send({ error: error.message });
            throw error;
        }
    });
    app.post("/api/auth/wechat/bind-current", { preHandler: requireAuth }, async (request, reply) => {
        try {
            const { code } = request.body;
            if (!code)
                return reply.code(400).send({ error: "缺少微信登录 code" });
            const auth = getAuth(request);
            const wechat = await exchangeWechatCode(String(code));
            const claimed = await prisma.user.findUnique({ where: { wechatOpenId: wechat.openid } });
            if (claimed && claimed.id !== auth.id)
                return reply.code(409).send({ error: "该微信已绑定其他账号" });
            return prisma.user.update({
                where: { id: auth.id },
                data: {
                    wechatOpenId: wechat.openid,
                    wechatUnionId: wechat.unionid || undefined,
                    lastWechatLoginAt: new Date(),
                },
            });
        }
        catch (error) {
            if (error instanceof WechatError)
                return reply.code(error.statusCode).send({ error: error.message });
            throw error;
        }
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
        await ensureFamilyMember(session.user.familyId, session.user.id, "owner");
        const token = app.jwt.sign({ sub: session.user.id, familyId: session.user.familyId });
        return { token };
    });
    app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const [user, family] = await Promise.all([
            prisma.user.findUnique({ where: { id: auth.id } }),
            prisma.family.findUnique({ where: { id: auth.familyId } }),
        ]);
        const member = await getActiveFamilyMember(auth.familyId, auth.id);
        return { user, family, member };
    });
    app.get("/api/family/members", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const [members, invites, currentMember] = await Promise.all([
            listFamilyMembers(auth.familyId),
            listPendingInvites(auth.familyId),
            getActiveFamilyMember(auth.familyId, auth.id),
        ]);
        return { members, invites, current_member: currentMember };
    });
    app.get("/api/family/memberships", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const memberships = await prisma.familyMember.findMany({
            where: { userId: auth.id, status: "active" },
            include: {
                family: { select: { id: true, name: true, createdAt: true } },
            },
            orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
        });
        return {
            memberships,
            current_family_id: auth.familyId,
        };
    });
    app.post("/api/family/switch", { preHandler: requireAuth }, async (request, reply) => {
        const auth = getAuth(request);
        const targetFamilyId = String(request.body?.familyId || request.body?.family_id || "").trim();
        if (!targetFamilyId)
            return reply.code(400).send({ error: "缺少 familyId" });
        const member = await getActiveFamilyMember(targetFamilyId, auth.id);
        if (!member)
            return reply.code(403).send({ error: "当前账号不是该家庭的成员" });
        const user = await prisma.user.update({
            where: { id: auth.id },
            data: { familyId: targetFamilyId },
        });
        return createSessionResponse(app, user);
    });
    app.post("/api/family/invites", { preHandler: requireAuth }, async (request, reply) => {
        const auth = getAuth(request);
        if (!(await requireOwner(auth.familyId, auth.id))) {
            return reply.code(403).send({ error: "只有家庭创建者可以邀请管理者" });
        }
        const body = request.body;
        const inviteEmail = normalizeEmail(body.email);
        const role = body.role === "owner" ? "admin" : "admin";
        const invite = await prisma.familyInvite.create({
            data: {
                familyId: auth.familyId,
                invitedByUserId: auth.id,
                inviteCode: createInviteCode(),
                inviteEmail: inviteEmail || null,
                role,
                status: "pending",
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
        });
        return reply.code(201).send({
            ...invite,
            accept_path: `/pages/login/login?family_invite=${invite.inviteCode}`,
            accept_url: `/family-edu/?family_invite=${invite.inviteCode}`,
        });
    });
    app.post("/api/family/invites/accept", { preHandler: requireAuth }, async (request, reply) => {
        const auth = getAuth(request);
        const code = String(request.body?.inviteCode || request.body?.invite_code || "").trim();
        if (!code)
            return reply.code(400).send({ error: "缺少家庭邀请 code" });
        const invite = await prisma.familyInvite.findUnique({ where: { inviteCode: code } });
        if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) {
            return reply.code(400).send({ error: "家庭邀请无效或已过期" });
        }
        const user = await prisma.user.findUnique({ where: { id: auth.id } });
        if (!user)
            return reply.code(401).send({ error: "未登录或登录已过期" });
        if (invite.inviteEmail && invite.inviteEmail !== normalizeEmail(user.email)) {
            return reply.code(403).send({ error: "当前账号邮箱与邀请对象不一致" });
        }
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { familyId: invite.familyId },
        });
        await ensureFamilyMember(invite.familyId, user.id, invite.role === "owner" ? "owner" : "admin");
        await prisma.familyInvite.update({
            where: { id: invite.id },
            data: {
                status: "accepted",
                acceptedByUserId: user.id,
                acceptedAt: new Date(),
            },
        });
        return createSessionResponse(app, updatedUser);
    });
    app.delete("/api/family/members/:memberId", { preHandler: requireAuth }, async (request, reply) => {
        const auth = getAuth(request);
        if (!(await requireOwner(auth.familyId, auth.id))) {
            return reply.code(403).send({ error: "只有家庭创建者可以移除管理者" });
        }
        const { memberId } = request.params;
        const member = await prisma.familyMember.findFirst({ where: { id: memberId, familyId: auth.familyId } });
        if (!member)
            return reply.code(404).send({ error: "家庭管理者不存在" });
        if (member.role === "owner")
            return reply.code(400).send({ error: "不能移除家庭创建者" });
        await prisma.$transaction([
            prisma.familyMember.update({ where: { id: member.id }, data: { status: "removed" } }),
            prisma.mcpToken.updateMany({
                where: { familyId: auth.familyId, userId: member.userId, status: "active" },
                data: { status: "revoked", revokedAt: new Date() },
            }),
            prisma.session.updateMany({ where: { userId: member.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        ]);
        return { ok: true };
    });
    app.delete("/api/family/invites/:inviteId", { preHandler: requireAuth }, async (request, reply) => {
        const auth = getAuth(request);
        if (!(await requireOwner(auth.familyId, auth.id))) {
            return reply.code(403).send({ error: "只有家庭创建者可以取消邀请" });
        }
        const { inviteId } = request.params;
        const invite = await prisma.familyInvite.findFirst({ where: { id: inviteId, familyId: auth.familyId } });
        if (!invite)
            return reply.code(404).send({ error: "家庭邀请不存在" });
        await prisma.familyInvite.update({ where: { id: invite.id }, data: { status: "cancelled" } });
        return { ok: true };
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
    app.get("/api/mobile/home", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const query = request.query;
        const [user, family, children, reports, homework, records] = await Promise.all([
            prisma.user.findUnique({ where: { id: auth.id } }),
            prisma.family.findUnique({ where: { id: auth.familyId } }),
            prisma.child.findMany({ where: { familyId: auth.familyId, status: "active" }, orderBy: { createdAt: "asc" } }),
            prisma.report.findMany({ where: { familyId: auth.familyId }, orderBy: { createdAt: "desc" }, take: 5 }),
            prisma.homework.findMany({ where: { familyId: auth.familyId }, orderBy: { dueDate: "asc" }, take: 15 }),
            prisma.record.findMany({ where: { familyId: auth.familyId }, orderBy: { date: "desc" }, take: 20 }),
        ]);
        const activeChild = children.find((child) => child.id === query.child_id) || children[0] || null;
        const childRecords = activeChild ? records.filter((item) => item.childId === activeChild.id) : [];
        const childReports = activeChild ? reports.filter((item) => item.childId === activeChild.id) : [];
        return {
            user,
            family,
            children,
            active_child: activeChild,
            records: childRecords.slice(0, 8),
            reports: childReports.slice(0, 5),
            homework,
            stats: {
                records: childRecords.length,
                writing: childRecords.filter((item) => item.type === "writing").length,
                reading: Math.round(childRecords.filter((item) => item.type === "reading").reduce((sum, item) => sum + (item.score || 0), 0) / Math.max(1, childRecords.filter((item) => item.type === "reading").length)),
                homework: Math.round(childRecords.filter((item) => item.type === "homework").reduce((sum, item) => sum + (item.score || 0), 0) / Math.max(1, childRecords.filter((item) => item.type === "homework").length)),
            },
        };
    });
    app.get("/api/mobile/growth", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const query = request.query;
        const { limit, offset } = pageValues(query, 20, 50);
        const children = await prisma.child.findMany({ where: { familyId, status: "active" }, orderBy: { createdAt: "asc" } });
        const activeChild = children.find((child) => child.id === query.child_id) || children[0] || null;
        if (!activeChild)
            return { children, active_child: null, records: [], reports: [], growth: [], page: { limit, offset, total_records: 0, total_reports: 0 } };
        const [records, reports, growthRecords, totalRecords, totalReports] = await Promise.all([
            prisma.record.findMany({ where: { childId: activeChild.id, familyId }, orderBy: { date: "desc" }, take: limit, skip: offset }),
            prisma.report.findMany({ where: { childId: activeChild.id, familyId }, orderBy: { createdAt: "desc" }, take: Math.min(10, limit), skip: offset }),
            prisma.record.findMany({ where: { childId: activeChild.id, familyId }, orderBy: { date: "asc" }, take: 80 }),
            prisma.record.count({ where: { childId: activeChild.id, familyId } }),
            prisma.report.count({ where: { childId: activeChild.id, familyId } }),
        ]);
        return {
            children,
            active_child: activeChild,
            records,
            reports,
            growth: growthRecords.map((record) => ({
                date: record.date.toISOString().slice(0, 10),
                type: record.type,
                score: record.score,
            })),
            page: { limit, offset, total_records: totalRecords, total_reports: totalReports },
        };
    });
    app.get("/api/mobile/learning", { preHandler: requireAuth }, async (request) => {
        const familyId = getAuth(request).familyId;
        const query = request.query;
        const moduleName = String(query.module || "questions");
        const qTab = String(query.q_tab || "questions");
        const wTab = String(query.w_tab || "wrong");
        const children = await prisma.child.findMany({ where: { familyId, status: "active" }, orderBy: { createdAt: "asc" } });
        const activeChild = children.find((child) => child.id === query.child_id) || children[0] || null;
        const childId = activeChild?.id || "";
        const { limit, offset } = pageValues(query, 20, 100);
        const common = { ...query, child_id: childId, limit, offset };
        let data = null;
        if (moduleName === "questions") {
            if (qTab === "types")
                data = await listQuestionTypes(familyId, common);
            else if (qTab === "mastery")
                data = await listStudentMastery(familyId, common);
            else
                data = await listQuestions(familyId, common);
        }
        else if (moduleName === "wrong") {
            if (wTab === "papers")
                data = await listPracticePapers(familyId, common);
            else if (wTab === "plans")
                data = await listRemediationPlans(familyId, common);
            else
                data = await listWrongQuestions(familyId, common);
        }
        else if (moduleName === "textbooks") {
            const [items, total] = await Promise.all([
                prisma.textbook.findMany({ where: { familyId }, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
                prisma.textbook.count({ where: { familyId } }),
            ]);
            data = { items, total, limit, offset };
        }
        else if (moduleName === "homework") {
            const [items, total] = await Promise.all([
                prisma.homework.findMany({ where: { familyId }, orderBy: { dueDate: "asc" }, take: limit, skip: offset }),
                prisma.homework.count({ where: { familyId } }),
            ]);
            data = { items, total, limit, offset };
        }
        else if (moduleName === "knowledge") {
            const [items, total] = await Promise.all([
                prisma.knowledgeItem.findMany({ where: { familyId }, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
                prisma.knowledgeItem.count({ where: { familyId } }),
            ]);
            data = { items, total, limit, offset };
        }
        return { children, active_child: activeChild, data };
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
    app.patch("/api/children/:childId", { preHandler: requireAuth }, async (request, reply) => {
        const { childId } = request.params;
        if (!(await ownsResource(getAuth(request).familyId, "child", childId)))
            return reply.code(404).send({ error: "学生不存在" });
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
        if (!(await ownsResource(getAuth(request).familyId, "child", childId)))
            return reply.code(404).send({ error: "学生不存在" });
        await prisma.child.delete({ where: { id: childId } });
        return reply.send({ ok: true });
    });
    app.get("/api/children/:childId/records", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        const { limit, offset } = pageValues(request.query, 50, 100);
        return prisma.record.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { date: "desc" }, take: limit, skip: offset });
    });
    app.get("/api/children/:childId/reports", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        const { limit, offset } = pageValues(request.query, 20, 100);
        return prisma.report.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" }, take: limit, skip: offset });
    });
    app.get("/api/children/:childId/growth", { preHandler: requireAuth }, async (request) => {
        const { childId } = request.params;
        const { limit, offset } = pageValues(request.query, 100, 200);
        const records = await prisma.record.findMany({ where: { childId, familyId: getAuth(request).familyId }, orderBy: { date: "asc" }, take: limit, skip: offset });
        return records.map((record) => ({
            date: record.date.toISOString().slice(0, 10),
            type: record.type,
            score: record.score,
        }));
    });
    app.get("/api/knowledge", { preHandler: requireAuth }, async (request) => {
        const { limit, offset } = pageValues(request.query, 50, 100);
        return prisma.knowledgeItem.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" }, take: limit, skip: offset });
    });
    app.post("/api/knowledge", { preHandler: requireAuth }, async (request, reply) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
        if (!(await ownsResource(familyId, "child", body.child_id)))
            return reply.code(404).send({ error: "学生不存在" });
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
    app.delete("/api/knowledge/:itemId", { preHandler: requireAuth }, async (request, reply) => {
        const { itemId } = request.params;
        if (!(await ownsResource(getAuth(request).familyId, "knowledgeItem", itemId)))
            return reply.code(404).send({ error: "知识库内容不存在" });
        await prisma.knowledgeItem.delete({ where: { id: itemId } });
        return { ok: true };
    });
    app.get("/api/homework", { preHandler: requireAuth }, async (request) => {
        const { limit, offset } = pageValues(request.query, 50, 100);
        return prisma.homework.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { dueDate: "asc" }, take: limit, skip: offset });
    });
    app.post("/api/homework", { preHandler: requireAuth }, async (request, reply) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
        if (!(await ownsResource(familyId, "child", body.child_id)))
            return reply.code(404).send({ error: "学生不存在" });
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
    app.post("/api/homework/:homeworkId/complete", { preHandler: requireAuth }, async (request, reply) => {
        const { homeworkId } = request.params;
        if (!(await ownsResource(getAuth(request).familyId, "homework", homeworkId)))
            return reply.code(404).send({ error: "作业不存在" });
        return prisma.homework.update({ where: { id: homeworkId }, data: { status: "done", completedAt: new Date() } });
    });
    app.patch("/api/homework/:homeworkId", { preHandler: requireAuth }, async (request, reply) => {
        const { homeworkId } = request.params;
        const body = request.body;
        const familyId = getAuth(request).familyId;
        if (!(await ownsResource(familyId, "homework", homeworkId)))
            return reply.code(404).send({ error: "作业不存在" });
        const childId = body.childId || body.child_id;
        if (childId && !(await ownsResource(familyId, "child", childId)))
            return reply.code(404).send({ error: "学生不存在" });
        const { id: _id, familyId: _familyId, family: _family, child: _child, child_id: _childId, estimated_minutes, due_date, ...safeBody } = body;
        if (childId)
            safeBody.childId = childId;
        if (estimated_minutes !== undefined)
            safeBody.estimatedMinutes = Number(estimated_minutes || 0);
        if (due_date !== undefined)
            safeBody.dueDate = due_date ? new Date(due_date) : null;
        return prisma.homework.update({ where: { id: homeworkId }, data: safeBody });
    });
    app.delete("/api/homework/:homeworkId", { preHandler: requireAuth }, async (request, reply) => {
        const { homeworkId } = request.params;
        if (!(await ownsResource(getAuth(request).familyId, "homework", homeworkId)))
            return reply.code(404).send({ error: "作业不存在" });
        await prisma.homework.delete({ where: { id: homeworkId } });
        return { ok: true };
    });
    app.get("/api/textbooks", { preHandler: requireAuth }, async (request) => {
        const { limit, offset } = pageValues(request.query, 50, 100);
        return prisma.textbook.findMany({ where: { familyId: getAuth(request).familyId }, orderBy: { createdAt: "desc" }, take: limit, skip: offset });
    });
    app.post("/api/textbooks", { preHandler: requireAuth }, async (request, reply) => {
        const familyId = getAuth(request).familyId;
        const body = request.body;
        if (!(await ownsResource(familyId, "child", body.child_id)))
            return reply.code(404).send({ error: "学生不存在" });
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
        const childId = String(value("child_id"));
        if (!(await ownsResource(familyId, "child", childId)))
            return reply.code(404).send({ error: "学生不存在" });
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
    app.patch("/api/textbooks/:textbookId", { preHandler: requireAuth }, async (request, reply) => {
        const { textbookId } = request.params;
        const body = request.body;
        const familyId = getAuth(request).familyId;
        if (!(await ownsResource(familyId, "textbook", textbookId)))
            return reply.code(404).send({ error: "教材不存在" });
        const childId = body.childId || body.child_id;
        if (childId && !(await ownsResource(familyId, "child", childId)))
            return reply.code(404).send({ error: "学生不存在" });
        const { id: _id, familyId: _familyId, family: _family, child: _child, child_id: _childId, ...safeBody } = body;
        if (childId)
            safeBody.childId = childId;
        return prisma.textbook.update({ where: { id: textbookId }, data: safeBody });
    });
    app.delete("/api/textbooks/:textbookId", { preHandler: requireAuth }, async (request, reply) => {
        const { textbookId } = request.params;
        if (!(await ownsResource(getAuth(request).familyId, "textbook", textbookId)))
            return reply.code(404).send({ error: "教材不存在" });
        await prisma.textbook.delete({ where: { id: textbookId } });
        return { ok: true };
    });
    app.get("/api/settings", { preHandler: requireAuth }, async (request) => {
        const auth = getAuth(request);
        const [user, family, childCount, mcpToken, member, members, invites, educationSettings, policyChanges] = await Promise.all([
            prisma.user.findUnique({ where: { id: auth.id } }),
            prisma.family.findUnique({ where: { id: auth.familyId } }),
            prisma.child.count({ where: { familyId: auth.familyId } }),
            getOrCreateFamilyMcpToken(auth.familyId, auth.id),
            getActiveFamilyMember(auth.familyId, auth.id),
            listFamilyMembers(auth.familyId),
            listPendingInvites(auth.familyId),
            getFamilyEducationSettings(auth.familyId),
            getPolicyHistory(auth.familyId),
        ]);
        const educationMethods = {
            available: EDUCATION_METHODS,
            recommended: recommendEducationMethods({
                educationPhilosophy: educationSettings?.educationPhilosophy,
                strictness: educationSettings?.strictness,
                communicationStyle: educationSettings?.communicationStyle,
            }),
        };
        return {
            user,
            family,
            member,
            members,
            invites,
            education_settings: educationSettings,
            education_methods: educationMethods,
            policy_changes: policyChanges,
            child_count: childCount,
            mcp_token: mcpToken,
            workbuddy_open_platform: mcpToken ? buildWorkbuddyOpenPlatformConfig(mcpToken) : null,
            workbuddy_prompt: mcpToken ? buildWorkbuddyPrompt(mcpToken) : "",
            doubao_prompt: mcpToken ? buildDoubaoPrompt(mcpToken) : "",
        };
    });
    app.get("/api/policies", { preHandler: requireAuth }, async (request) => {
        return listFamilyPolicies(getAuth(request).familyId);
    });
    app.get("/api/policies/:skillId/effective", { preHandler: requireAuth }, async (request) => {
        const { skillId } = request.params;
        const effective = await getEffectiveSkill(getAuth(request).familyId, skillId);
        if (!effective)
            return { error: "skill not found" };
        return effective;
    });
    app.patch("/api/policies/:skillId", { preHandler: requireAuth }, async (request) => {
        const { skillId } = request.params;
        const body = request.body;
        return updateFamilyProfile(getAuth(request).familyId, skillId, {
            philosophy: body.philosophy,
            communicationStyle: body.communication_style,
            strictness: body.strictness,
            parentGoals: Array.isArray(body.parent_goals) ? body.parent_goals : body.parent_goals ? String(body.parent_goals).split(/[,，]/).map((item) => item.trim()).filter(Boolean) : undefined,
        });
    });
    app.get("/api/policy-changes", { preHandler: requireAuth }, async (request) => {
        return getPolicyHistory(getAuth(request).familyId);
    });
    app.get("/api/education-settings", { preHandler: requireAuth }, async (request) => {
        return getFamilyEducationSettings(getAuth(request).familyId);
    });
    app.patch("/api/education-settings", { preHandler: requireAuth }, async (request) => {
        const body = request.body;
        return updateFamilyEducationSettings(getAuth(request).familyId, {
            educationPhilosophy: body.education_philosophy,
            communicationStyle: body.communication_style,
            strictness: body.strictness,
            parentGoals: Array.isArray(body.parent_goals) ? body.parent_goals : body.parent_goals ? String(body.parent_goals).split(/[,，]/).map((item) => item.trim()).filter(Boolean) : undefined,
        });
    });
    app.get("/api/education-methods", { preHandler: requireAuth }, async (request) => {
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
    app.post("/api/policy-changes/:changeId/review", { preHandler: requireAuth }, async (request, reply) => {
        const { changeId } = request.params;
        const { action } = request.body;
        if (!(await ownsResource(getAuth(request).familyId, "policyChange", changeId)))
            return reply.code(404).send({ error: "优化建议不存在" });
        return reviewPolicyChange(changeId, action);
    });
    registerQuestionBankRoutes(app, requireAuth, (request) => getAuth(request).familyId);
    registerWrongBookRoutes(app, requireAuth, (request) => getAuth(request).familyId);
    registerV2Routes(app, requireAuth, (request) => getAuth(request));
    await registerMcpHttp(app);
    app.setNotFoundHandler((request, reply) => {
        if (!request.url.startsWith("/api") && !request.url.startsWith("/mcp")) {
            return reply.sendFile("index.html");
        }
        return reply.code(404).send({ error: "not found" });
    });
    return app;
}
