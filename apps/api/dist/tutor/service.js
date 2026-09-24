import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { hasChatCredentials } from "./llm/index.js";
/**
 * 私教的小工具函数。放这里是为了让 routes 只做协议适配。
 */
export function isTutorReady() {
    return env.TUTOR_ENABLED && hasChatCredentials();
}
/** 会话列表。默认只给活跃会话，可按状态查。 */
export async function listArchivedOrActiveConversations(familyId, childId, status) {
    const where = { familyId };
    if (status)
        where.status = status;
    else
        where.status = "active";
    if (childId)
        where.childId = childId;
    const rows = await prisma.tutorConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        select: {
            id: true,
            childId: true,
            persona: true,
            title: true,
            status: true,
            summary: true,
            lastMessageAt: true,
            createdAt: true,
        },
    });
    return rows;
}
