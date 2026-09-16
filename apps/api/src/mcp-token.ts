import crypto from "node:crypto";
import { prisma } from "./prisma.js";
import { ensureFamilyMember } from "./family-members.js";

const encryptionKey = crypto.createHash("sha256").update(process.env.JWT_SECRET || "dev-only-change-me").digest();

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function encryptToken(token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptToken(payload: string) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export async function issueFamilyMcpToken(familyId: string, userId?: string, name = "workbuddy") {
  const raw = `family_mcp_${crypto.randomBytes(24).toString("hex")}`;
  const member = userId ? await ensureFamilyMember(familyId, userId) : null;
  await prisma.mcpToken.create({
    data: {
      familyId,
      userId,
      familyMemberId: member?.id,
      tokenHash: hashToken(raw),
      tokenCipher: encryptToken(raw),
      name,
      status: "active",
    },
  });
  return raw;
}

export async function getOrCreateFamilyMcpToken(familyId: string, userId?: string) {
  const member = userId ? await ensureFamilyMember(familyId, userId) : null;
  const existing = await prisma.mcpToken.findFirst({
    where: { familyId, userId: userId || null, status: "active", revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.tokenCipher) return decryptToken(existing.tokenCipher);
  const legacy = !userId ? null : await prisma.mcpToken.findFirst({
    where: { familyId, userId: null, status: "active", revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (legacy && !legacy.familyMemberId) {
    await prisma.mcpToken.update({
      where: { id: legacy.id },
      data: { userId, familyMemberId: member?.id },
    });
    if (legacy.tokenCipher) return decryptToken(legacy.tokenCipher);
  }
  return issueFamilyMcpToken(familyId, userId);
}

export async function resolveFamilyByMcpToken(rawToken: string) {
  if (!rawToken) return null;
  const token = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!token || token.status !== "active" || token.revokedAt) return null;
  if (token.userId) {
    const [member, user] = await Promise.all([
      prisma.familyMember.findFirst({
        where: { familyId: token.familyId, userId: token.userId, status: "active" },
        select: { id: true },
      }),
      prisma.user.findUnique({ where: { id: token.userId }, select: { familyId: true, status: true } }),
    ]);
    if (!member) return null;
    if (!user || user.status !== "active" || user.familyId !== token.familyId) return null;
  }
  await prisma.mcpToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return token.familyId;
}

export async function revokeFamilyMcpToken(tokenId: string) {
  await prisma.mcpToken.update({
    where: { id: tokenId },
    data: { status: "revoked", revokedAt: new Date() },
  });
}

/** Legacy token-mode connections, listed for management after the OAuth rollout. */
export async function listLegacyMcpConnections(familyId: string) {
  const tokens = await prisma.mcpToken.findMany({
    where: { familyId, status: "active", revokedAt: null },
    include: {
      user: { select: { id: true, email: true, wechatNickname: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return tokens.map((token) => ({
    id: token.id,
    kind: "legacy" as const,
    name: token.name || "workbuddy",
    created_at: token.createdAt,
    last_used_at: token.lastUsedAt,
    authorized_by: token.user
      ? token.user.wechatNickname || token.user.email || "微信用户"
      : "家庭级凭证",
    blocked: Boolean(token.user && !token.familyMemberId),
  }));
}

export async function revokeLegacyMcpConnection(familyId: string, tokenId: string) {
  const result = await prisma.mcpToken.updateMany({
    where: { id: tokenId, familyId, status: "active", revokedAt: null },
    data: { status: "revoked", revokedAt: new Date() },
  });
  return result.count > 0;
}
