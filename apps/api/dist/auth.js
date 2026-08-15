import bcrypt from "bcryptjs";
import crypto from "node:crypto";
export function hashPassword(password) {
    return bcrypt.hash(password, 10);
}
export function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export function createRefreshTokenHash() {
    const token = crypto.randomBytes(32).toString("hex");
    return { token, hash: crypto.createHash("sha256").update(token).digest("hex") };
}
