import { afterAll, beforeAll, describe, expect, it } from "vitest";
process.env.WEB_DIST = ".";
const { buildApp } = await import("./app.js");
let app;
beforeAll(async () => {
    app = await buildApp();
});
afterAll(async () => {
    await app.close();
});
describe("API integration", () => {
    it("returns health", async () => {
        const response = await app.inject({ method: "GET", url: "/api/health" });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ ok: true, service: "family-edu-agent" });
    });
    it("rejects invalid invite code", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { inviteCode: "BAD", email: "test@example.com", password: "123456" },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: "邀请码无效" });
    });
    it("reports unconfigured wechat login", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/api/auth/wechat/login",
            payload: { code: "test-code" },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ error: "微信登录未配置，请先设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET" });
    });
});
