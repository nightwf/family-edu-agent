import crypto from "node:crypto";
import { prisma } from "./prisma.js";
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
export async function issueFamilyMcpToken(familyId, name = "workbuddy") {
    const raw = `family_mcp_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.mcpToken.create({
        data: {
            familyId,
            tokenHash: hashToken(raw),
            name,
            status: "active",
        },
    });
    return raw;
}
export async function getOrCreateFamilyMcpToken(familyId) {
    const existing = await prisma.mcpToken.findFirst({
        where: { familyId, status: "active", revokedAt: null },
        orderBy: { createdAt: "desc" },
    });
    if (existing)
        return null;
    return issueFamilyMcpToken(familyId);
}
export async function resolveFamilyByMcpToken(rawToken) {
    if (!rawToken)
        return null;
    const token = await prisma.mcpToken.findUnique({
        where: { tokenHash: hashToken(rawToken) },
    });
    if (!token || token.status !== "active" || token.revokedAt)
        return null;
    return token.familyId;
}
export async function revokeFamilyMcpToken(tokenId) {
    await prisma.mcpToken.update({
        where: { id: tokenId },
        data: { status: "revoked", revokedAt: new Date() },
    });
}
