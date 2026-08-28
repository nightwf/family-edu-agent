import crypto from "node:crypto";
import { prisma } from "./prisma.js";
export function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}
export function createInviteCode() {
    return `HEYAFAM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
export async function ensureFamilyMember(familyId, userId, fallbackRole = "admin") {
    const existing = await prisma.familyMember.findUnique({
        where: { familyId_userId: { familyId, userId } },
    });
    if (existing)
        return existing;
    return prisma.familyMember.create({
        data: {
            familyId,
            userId,
            role: fallbackRole,
            status: "active",
            joinedAt: new Date(),
        },
    });
}
export async function getActiveFamilyMember(familyId, userId) {
    return prisma.familyMember.findFirst({
        where: { familyId, userId, status: "active" },
    });
}
export async function requireOwner(familyId, userId) {
    const member = await getActiveFamilyMember(familyId, userId);
    return Boolean(member && member.role === "owner");
}
export async function listFamilyMembers(familyId) {
    return prisma.familyMember.findMany({
        where: { familyId, status: "active" },
        include: {
            user: {
                select: {
                    id: true,
                    email: true,
                    wechatOpenId: true,
                    wechatNickname: true,
                    wechatAvatarUrl: true,
                    lastWechatLoginAt: true,
                    createdAt: true,
                },
            },
        },
        orderBy: [{ role: "desc" }, { joinedAt: "asc" }],
    });
}
export async function listPendingInvites(familyId) {
    return prisma.familyInvite.findMany({
        where: {
            familyId,
            status: "pending",
            expiresAt: { gt: new Date() },
        },
        include: {
            invitedBy: { select: { id: true, email: true } },
            acceptedBy: { select: { id: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
    });
}
