import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { openFile, saveFile } from "../storage.js";
import { assertChildInFamily } from "../v2/guards.js";
import { buildTutorPersona } from "./persona.js";
import { createTutorToolset } from "./mcp-tools.js";
import { getChatProvider, hasChatCredentials, pickModel } from "./llm/index.js";
import { runTutorTurn } from "./runtime.js";
import { normalizePersona } from "./tool-policy.js";
import { getQuotaState } from "./quota.js";
import { buildHistory, draftFromTurn, extractEvidence } from "./memory.js";
import { listArchivedOrActiveConversations, isTutorReady } from "./service.js";
import { getVoiceStatus, synthesize, transcribe, VoiceNotConfiguredError } from "./voice/index.js";

/**
 * /api/tutor/*：内置私教的对外接口。
 * 家庭边界只由登录会话推导，不接受客户端传入 familyId。
 * 私教入口本期只在安卓 APK 端（前端按 UA 判定），接口本身不按设备区分。
 */

function getAuth(request: FastifyRequest) {
  const payload = (request as any).user as { sub: string; familyId: string };
  return { userId: payload.sub, familyId: payload.familyId };
}

const createConversationSchema = z.object({
  child_id: z.string().optional().nullable(),
  persona: z.string().optional(),
  title: z.string().optional(),
});

const sendMessageSchema = z.object({
  text: z.string().optional(),
  attachments: z.array(z.string()).optional(),
});

function sseWrite(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function registerTutorRoutes(
  app: FastifyInstance,
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  const requireTutor = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!env.TUTOR_ENABLED) {
      return reply.code(503).send({ error: "私教功能尚未启用" });
    }
  };

  app.get("/api/tutor/status", { preHandler: requireTutor as any }, async (request) => {
    const { familyId } = getAuth(request);
    const quota = await getQuotaState(familyId);
    return {
      enabled: env.TUTOR_ENABLED,
      ready: isTutorReady(),
      model_configured: hasChatCredentials(),
      quota: {
        message_limit: quota.messageLimit,
        used_messages: quota.usedMessages,
        left_messages: quota.leftMessages,
      },
    };
  });

  app.get("/api/tutor/quota", { preHandler: requireTutor as any }, async (request) => {
    const { familyId } = getAuth(request);
    const childId = (request.query as any)?.child_id || null;
    if (childId) await assertChildInFamily(familyId, String(childId));
    return getQuotaState(familyId, childId);
  });

  app.get("/api/tutor/conversations", { preHandler: requireTutor as any }, async (request) => {
    const { familyId } = getAuth(request);
    const query = request.query as any;
    const childId = query?.child_id ? String(query.child_id) : undefined;
    if (childId) await assertChildInFamily(familyId, childId);
    return { conversations: await listArchivedOrActiveConversations(familyId, childId, query?.status) };
  });

  app.post("/api/tutor/conversations", { preHandler: requireTutor as any }, async (request, reply) => {
    const { userId, familyId } = getAuth(request);
    const parsed = createConversationSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "参数不正确" });
    const childId = parsed.data.child_id || null;
    if (childId) {
      // 关键：会话创建时就把孩子钉住，之后模型改不了
      await assertChildInFamily(familyId, childId);
    }
    const conversation = await prisma.tutorConversation.create({
      data: {
        familyId,
        childId,
        userId,
        persona: normalizePersona(parsed.data.persona),
        title: parsed.data.title || null,
      },
    });
    return { conversation };
  });

  app.get("/api/tutor/conversations/:conversationId/messages", { preHandler: requireTutor as any }, async (request, reply) => {
    const { familyId } = getAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conversation = await findOwnConversation(familyId, conversationId);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });

    const query = request.query as any;
    const limit = Math.min(Math.max(Number(query?.limit || 30), 1), 100);
    const messages = await prisma.tutorMessage.findMany({
      where: { conversationId, familyId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { conversation, messages: messages.reverse() };
  });

  /**
   * 发消息：SSE 流式返回。
   * 事件：text / tool / replace / done / error
   */
  app.post("/api/tutor/conversations/:conversationId/messages", { preHandler: requireTutor as any }, async (request, reply) => {
    const { userId, familyId } = getAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conversation = await findOwnConversation(familyId, conversationId);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });
    if (conversation.status !== "active") return reply.code(400).send({ error: "会话已归档" });

    const parsed = sendMessageSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.code(400).send({ error: "参数不正确" });
    const text = (parsed.data.text || "").trim();
    const attachments = parsed.data.attachments || [];
    if (!text && !attachments.length) return reply.code(400).send({ error: "消息不能为空" });

    const quota = await getQuotaState(familyId, conversation.childId);
    if (!quota.allowed) return reply.code(429).send({ error: quota.reason });

    if (!hasChatCredentials()) {
      return reply.code(503).send({ error: "私教尚未配置模型密钥，请联系管理员" });
    }

    // 先落用户消息，保证即使模型失败也有记录
    await prisma.tutorMessage.create({
      data: {
        conversationId,
        familyId,
        childId: conversation.childId,
        role: "user",
        content: text || "（图片消息）",
        attachments: attachments.length ? attachments : undefined,
      },
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const persona = normalizePersona(conversation.persona);
    let toolset: Awaited<ReturnType<typeof createTutorToolset>> | undefined;
    let fullText = "";

    try {
      const [systemPrompt, history, toolsetReady] = await Promise.all([
        buildTutorPersona({ familyId, persona, childId: conversation.childId }),
        buildHistory(conversationId),
        createTutorToolset(familyId, persona, conversation.childId),
      ]);
      toolset = toolsetReady;

      const images = attachments.length ? await resolveAttachmentUrls(attachments) : [];

      for await (const event of runTutorTurn({
        familyId,
        childId: conversation.childId,
        conversationId,
        persona,
        systemPrompt,
        history,
        userMessage: text || "请看看这张图片。",
        images,
        provider: getChatProvider(),
        toolset,
        model: pickModel(images.length > 0),
      })) {
        if (event.type === "text") {
          fullText += event.delta;
          sseWrite(reply, "text", { delta: event.delta });
        } else if (event.type === "tool") {
          sseWrite(reply, "tool", { name: event.name, ok: event.ok });
        } else if (event.type === "replace") {
          sseWrite(reply, "replace", { reason: event.reason });
        } else if (event.type === "error") {
          // message 是给家长看的友好提示；detail 是上游原文，仅供排查。
          sseWrite(reply, "error", { message: event.message, retryable: event.retryable, detail: event.detail });
        } else if (event.type === "done") {
          const assistant = await prisma.tutorMessage.create({
            data: {
              conversationId,
              familyId,
              childId: conversation.childId,
              role: "assistant",
              content: fullText,
              toolCalls: event.toolCalls.length ? (event.toolCalls as any) : undefined,
              model: pickModel(images.length > 0),
              promptTokens: event.usage.promptTokens,
              completionTokens: event.usage.completionTokens,
            },
          });
          await prisma.tutorConversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date(), title: conversation.title || deriveTitle(text) },
          });
          sseWrite(reply, "done", {
            messageId: assistant.id,
            usage: event.usage,
            quotaLeft: Math.max(0, quota.leftMessages - 1),
          });
        }
      }
    } catch (error) {
      sseWrite(reply, "error", { message: "私教暂时不可用，请稍后再试", retryable: true });
      app.log.error(error, "tutor turn failed");
    } finally {
      await toolset?.close().catch(() => {});
      reply.raw.end();
    }
  });

  /** 图片上传：走现有对象存储，只返回 key，发消息时携带。 */
  app.post("/api/tutor/conversations/:conversationId/attachments", { preHandler: requireTutor as any }, async (request, reply) => {
    const { familyId } = getAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conversation = await findOwnConversation(familyId, conversationId);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });

    const file = await (request as any).file?.().catch(() => null);
    if (!file) return reply.code(400).send({ error: "没有收到文件" });
    const buffer = await file.toBuffer();
    if (buffer.length > 8 * 1024 * 1024) return reply.code(413).send({ error: "图片过大（上限 8MB）" });

    const contentType = file.mimetype || "application/octet-stream";
    if (!/^image\//.test(contentType)) return reply.code(400).send({ error: "只支持图片" });

    const key = `tutor/${familyId}/${conversationId}/${Date.now()}-${file.filename || "image"}`;
    const stored = await saveFile(key, buffer, contentType);
    return { objectKey: stored, contentType };
  });

  /** 把本轮对话沉淀为一条待确认证据。 */
  app.post("/api/tutor/conversations/:conversationId/evidence", { preHandler: requireTutor as any }, async (request, reply) => {
    const { userId, familyId } = getAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conversation = await findOwnConversation(familyId, conversationId);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });
    if (!conversation.childId) return reply.code(400).send({ error: "家庭级会话不生成孩子证据" });
    await assertChildInFamily(familyId, conversation.childId);

    const body = (request.body || {}) as any;
    const draft =
      typeof body.observed_behavior === "string" && body.observed_behavior.trim()
        ? { type: body.type || "PARENT_NOTE", observedBehavior: body.observed_behavior, confidence: body.confidence }
        : await buildDraftFromConversation(conversationId);
    if (!draft) return reply.code(400).send({ error: "没有可沉淀的内容" });

    const record = await extractEvidence({
      familyId,
      childId: conversation.childId,
      conversationId,
      draft,
      actorId: userId,
    });
    if (!record) return { skipped: true, reason: "已有相同记录，未重复写入" };
    return { evidence: record, reviewStatus: record.reviewStatus };
  });

  app.delete("/api/tutor/conversations/:conversationId", { preHandler: requireTutor as any }, async (request, reply) => {
    const { familyId } = getAuth(request);
    const { conversationId } = request.params as { conversationId: string };
    const conversation = await findOwnConversation(familyId, conversationId);
    if (!conversation) return reply.code(404).send({ error: "会话不存在" });
    await prisma.tutorConversation.update({ where: { id: conversationId }, data: { status: "archived" } });
    return { archived: true };
  });

  // ---- 语音：未开通时如实返回 503，前端据此隐藏按钮，而不是静默失败 ----

  app.get("/api/tutor/voice/status", { preHandler: requireTutor as any }, async () => getVoiceStatus());

  app.post("/api/tutor/voice/transcribe", { preHandler: requireTutor as any }, async (request, reply) => {
    const file = await (request as any).file?.().catch(() => null);
    if (!file) return reply.code(400).send({ error: "没有收到音频" });
    const buffer = await file.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) return reply.code(413).send({ error: "录音过大（上限 5MB）" });
    const format = (file.filename?.split(".").pop() || "mp3").toLowerCase();
    try {
      const text = await transcribe(buffer, format);
      return { text };
    } catch (error) {
      const status = error instanceof VoiceNotConfiguredError ? 503 : 502;
      return reply.code(status).send({ error: (error as Error).message });
    }
  });

  app.post("/api/tutor/voice/speak", { preHandler: requireTutor as any }, async (request, reply) => {
    const body = (request.body || {}) as any;
    const text = String(body.text || "").trim();
    if (!text) return reply.code(400).send({ error: "没有要朗读的内容" });
    try {
      const { audio, contentType } = await synthesize(text.slice(0, 1000), body.voice_type);
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "no-store");
      return reply.send(audio);
    } catch (error) {
      const status = error instanceof VoiceNotConfiguredError ? 503 : 502;
      return reply.code(status).send({ error: (error as Error).message });
    }
  });
}

async function findOwnConversation(familyId: string, conversationId: string) {
  return prisma.tutorConversation.findFirst({ where: { id: conversationId, familyId } });
}

function deriveTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "图片提问";
  return clean.length > 20 ? `${clean.slice(0, 20)}…` : clean;
}

async function buildDraftFromConversation(conversationId: string) {
  const recent = await prisma.tutorMessage.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { role: true, content: true },
  });
  const user = recent.find((row) => row.role === "user")?.content || "";
  const assistant = recent.find((row) => row.role === "assistant")?.content || "";
  return draftFromTurn(user, assistant);
}

/**
 * 把对象存储里的图片读成 data URL 交给模型。
 * 刻意不生成公开可访问的图片地址：家庭作业照片不该有公网 URL。
 */
async function resolveAttachmentUrls(keys: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const key of keys) {
    if (key.startsWith("data:")) {
      urls.push(key);
      continue;
    }
    try {
      const stream = await openFile(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as any) chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      const contentType = key.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      urls.push(`data:${contentType};base64,${buffer.toString("base64")}`);
    } catch {
      // 读不到的附件跳过，不因此中断整轮对话
    }
  }
  return urls;
}
