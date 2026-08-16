import crypto from "node:crypto";
import { prisma } from "./prisma.js";
const encryptionKey = crypto.createHash("sha256").update(process.env.JWT_SECRET || "dev-only-change-me").digest();
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
function encryptToken(token) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decryptToken(payload) {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
export async function issueFamilyMcpToken(familyId, name = "workbuddy") {
    const raw = `family_mcp_${crypto.randomBytes(24).toString("hex")}`;
    await prisma.mcpToken.create({
        data: {
            familyId,
            tokenHash: hashToken(raw),
            tokenCipher: encryptToken(raw),
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
    if (existing?.tokenCipher)
        return decryptToken(existing.tokenCipher);
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
