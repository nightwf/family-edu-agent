import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ensureFamilyMember, getActiveFamilyMember } from "./family-members.js";
export async function findOrCreateWechatUser(openid, unionid) {
    const existing = await prisma.user.findUnique({ where: { wechatOpenId: openid } });
    if (existing) {
        return prisma.user.update({
            where: { id: existing.id },
            data: { wechatUnionId: unionid || existing.wechatUnionId, lastWechatLoginAt: new Date() },
        });
    }
    return prisma.user.create({
        data: {
            familyId: null,
            email: null,
            passwordHash: null,
            wechatOpenId: openid,
            wechatUnionId: unionid || null,
            lastWechatLoginAt: new Date(),
        },
    });
}
export async function createUniqueFamilyJoinCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const code = String(crypto.randomInt(100000, 1000000));
        const exists = await prisma.family.findUnique({ where: { joinCode: code }, select: { id: true } });
        if (!exists)
            return code;
    }
    throw new Error("暂时无法生成家庭编码，请稍后重试");
}
export async function ensureFamilyJoinCode(familyId) {
    const family = await prisma.family.findUnique({ where: { id: familyId } });
    if (!family)
        throw new Error("家庭不存在");
    if (family.joinCode)
        return family.joinCode;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            const joinCode = await createUniqueFamilyJoinCode();
            const updated = await prisma.family.update({ where: { id: familyId }, data: { joinCode } });
            return updated.joinCode;
        }
        catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
                throw error;
        }
    }
    throw new Error("暂时无法生成家庭编码，请稍后重试");
}
export async function createFamilyForUser(userId, familyName) {
    const joinCode = await createUniqueFamilyJoinCode();
    return prisma.$transaction(async (tx) => {
        const family = await tx.family.create({
            data: {
                name: String(familyName || "我的家庭").trim().slice(0, 40) || "我的家庭",
                inviteCode: `WX-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
                joinCode,
            },
        });
        await tx.familyMember.create({
            data: { familyId: family.id, userId, role: "owner", status: "active", joinedAt: new Date() },
        });
        const user = await tx.user.update({ where: { id: userId }, data: { familyId: family.id } });
        return { family, user };
    });
}
export async function applyToFamilyByJoinCode(userId, rawCode) {
    const joinCode = String(rawCode || "").trim();
    if (!/^\d{6}$/.test(joinCode))
        throw new Error("请输入正确的 6 位家庭编码");
    const family = await prisma.family.findUnique({ where: { joinCode }, select: { id: true, name: true } });
    if (!family)
        throw new Error("家庭编码不存在，请向家庭创建者确认");
    const existingMember = await getActiveFamilyMember(family.id, userId);
    if (existingMember)
        return { already_member: true, family, request: null };
    const request = await prisma.familyJoinRequest.upsert({
        where: { familyId_userId: { familyId: family.id, userId } },
        create: { familyId: family.id, userId, status: "pending" },
        update: { status: "pending", reviewedAt: null, reviewedByUserId: null },
    });
    return { already_member: false, family, request };
}
export async function listFamilyJoinRequests(familyId) {
    return prisma.familyJoinRequest.findMany({
        where: { familyId, status: "pending" },
        include: {
            user: { select: { id: true, wechatNickname: true, wechatAvatarUrl: true, createdAt: true } },
        },
        orderBy: { createdAt: "asc" },
    });
}
export async function reviewFamilyJoinRequest(familyId, requestId, reviewerUserId, action) {
    const joinRequest = await prisma.familyJoinRequest.findFirst({
        where: { id: requestId, familyId, status: "pending" },
    });
    if (!joinRequest)
        throw new Error("加入申请不存在或已处理");
    if (action === "rejected") {
        return prisma.familyJoinRequest.update({
            where: { id: joinRequest.id },
            data: { status: "rejected", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
        });
    }
    await prisma.$transaction(async (tx) => {
        await tx.familyMember.upsert({
            where: { familyId_userId: { familyId, userId: joinRequest.userId } },
            create: { familyId, userId: joinRequest.userId, role: "admin", status: "active", joinedAt: new Date() },
            update: { role: "admin", status: "active", joinedAt: new Date() },
        });
        const applicant = await tx.user.findUniqueOrThrow({ where: { id: joinRequest.userId } });
        if (!applicant.familyId)
            await tx.user.update({ where: { id: applicant.id }, data: { familyId } });
        await tx.familyJoinRequest.update({
            where: { id: joinRequest.id },
            data: { status: "approved", reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
        });
    });
    await ensureFamilyMember(familyId, joinRequest.userId, "admin");
    return prisma.familyJoinRequest.findUnique({ where: { id: joinRequest.id } });
}
