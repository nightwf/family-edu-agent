import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, createRefreshTokenHash } from "./auth.js";
describe("auth helpers", () => {
    it("hashes and verifies passwords", async () => {
        const hash = await hashPassword("123456");
        expect(await verifyPassword("123456", hash)).toBe(true);
        expect(await verifyPassword("bad-password", hash)).toBe(false);
    });
    it("creates distinct refresh token hashes", () => {
        const first = createRefreshTokenHash();
        const second = createRefreshTokenHash();
        expect(first.token).not.toBe(second.token);
        expect(first.hash).not.toBe(second.hash);
    });
});
