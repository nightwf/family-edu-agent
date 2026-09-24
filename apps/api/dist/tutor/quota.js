import { prisma } from "../prisma.js";
import { env } from "../env.js";
/**
 * 配额：前置检查，避免成本随使用量失控。
 * 超限给可读提示，不报 500。
 */
function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
export async function getQuotaState(familyId, childId) {
    const since = startOfToday();
    const where = { familyId, role: "user", createdAt: { gte: since } };
    if (childId)
        where.childId = childId;
    const [usedMessages, tokenRows] = await Promise.all([
        prisma.tutorMessage.count({ where }),
        prisma.tutorMessage.findMany({
            where: { familyId, createdAt: { gte: since }, role: "assistant" },
            select: { promptTokens: true, completionTokens: true },
        }),
    ]);
    const usedTokens = tokenRows.reduce((sum, row) => sum + (row.promptTokens || 0) + (row.completionTokens || 0), 0);
    const messageLimit = env.TUTOR_DAILY_MESSAGE_LIMIT;
    const tokenLimit = env.TUTOR_DAILY_TOKEN_LIMIT;
    const leftMessages = Math.max(0, messageLimit - usedMessages);
    const leftTokens = tokenLimit ? Math.max(0, tokenLimit - usedTokens) : Number.POSITIVE_INFINITY;
    if (leftMessages <= 0) {
        return {
            messageLimit,
            usedMessages,
            leftMessages,
            tokenLimit,
            usedTokens,
            leftTokens,
            allowed: false,
            reason: "今天的使用次数已经用完，明天再继续吧。",
        };
    }
    if (tokenLimit && leftTokens <= 0) {
        return {
            messageLimit,
            usedMessages,
            leftMessages,
            tokenLimit,
            usedTokens,
            leftTokens,
            allowed: false,
            reason: "今天的用量已达上限，明天再继续吧。",
        };
    }
    return { messageLimit, usedMessages, leftMessages, tokenLimit, usedTokens, leftTokens, allowed: true };
}
