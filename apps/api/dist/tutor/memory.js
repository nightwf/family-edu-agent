import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { createEvidenceRecord } from "../v2/evidence.js";
/**
 * 记忆分三层：
 *   短期 = 最近 N 轮原文（本文件 buildHistory）
 *   中期 = 会话滚动摘要（summarizeConversation）
 *   长期 = 领域记忆，即证据回流（extractEvidence）
 * 这是私教与普通聊天工具的本质区别：聊天会变成孩子的记录。
 */
/** 取最近 N 轮对话，按时间正序返回。 */
export async function buildHistory(conversationId, windowTurns = env.TUTOR_CONTEXT_WINDOW_TURNS) {
    const rows = await prisma.tutorMessage.findMany({
        where: { conversationId, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "desc" },
        take: Math.max(2, windowTurns * 2),
        select: { role: true, content: true },
    });
    return rows
        .reverse()
        .filter((row) => Boolean(row.content?.trim()))
        .map((row) => ({ role: row.role, content: row.content }));
}
/** 粗略估算 token，用于判断是否需要重算摘要。 */
function approxTokens(text) {
    return Math.ceil(text.length / 2);
}
/**
 * 会话摘要：中期记忆。超窗口时重算，避免把整段历史喂进上下文。
 * 只做机械归纳（首问 + 关键节点），不额外调用模型——摘要不该再花一次模型钱。
 */
export async function summarizeConversation(conversationId) {
    const conversation = await prisma.tutorConversation.findUnique({ where: { id: conversationId } });
    if (!conversation)
        return null;
    const messages = await prisma.tutorMessage.findMany({
        where: { conversationId, role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
    });
    if (!messages.length)
        return null;
    const firstUser = messages.find((message) => message.role === "user")?.content || "";
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant")?.content || "";
    const summary = [
        `共 ${messages.length} 条消息。`,
        firstUser ? `起点：${firstUser.slice(0, 120)}` : "",
        lastAssistant ? `最近结论：${lastAssistant.slice(0, 160)}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    await prisma.tutorConversation.update({
        where: { id: conversationId },
        data: { summary, summarizedAt: new Date() },
    });
    return summary;
}
export function needsSummarize(messageCount) {
    return messageCount > env.TUTOR_CONTEXT_WINDOW_TURNS * 2;
}
/**
 * 从一轮对话抽取一条待确认证据。
 * 只写孩子确实做过的行为，不写模型推测；写前去重。
 */
export async function extractEvidence(options) {
    const { familyId, childId, draft } = options;
    if (!draft.observedBehavior?.trim())
        return null;
    // 去重：同一孩子、同一类型、24 小时内已有相似记录就不再写
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await prisma.evidenceRecord.findFirst({
        where: {
            familyId,
            childId,
            type: draft.type,
            observedAt: { gte: since },
            source: "tutor",
        },
        select: { id: true, observedBehavior: true },
    });
    if (existing && existing.observedBehavior === draft.observedBehavior)
        return null;
    return createEvidenceRecord(familyId, {
        childId,
        type: draft.type,
        observedBehavior: draft.observedBehavior,
        confidence: draft.confidence ?? 0.6,
        source: "tutor",
        sourceRef: options.conversationId,
    }, { type: "tutor", id: options.actorId || undefined });
}
/** 把"这轮聊了什么"整理成一条可确认证据，供家长在网页端确认。 */
export function draftFromTurn(userMessage, assistantText) {
    const text = `${userMessage} ${assistantText}`.trim();
    if (!text)
        return null;
    const observed = userMessage.trim().slice(0, 300);
    if (!observed)
        return null;
    return {
        type: "PARENT_NOTE",
        observedBehavior: `[私教对话] ${observed}`,
        confidence: 0.5,
    };
}
export { approxTokens };
