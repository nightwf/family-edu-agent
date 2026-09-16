import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { hashOpaque, isAllowedWorkbuddyRedirectUri, verifyPkceS256 } from "./oauth.js";
function challengeFor(verifier) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
}
describe("OAuth PKCE", () => {
    it("accepts a matching S256 verifier", () => {
        const verifier = "abcdefghijklmnopqrstuvwxyz0123456789-._~";
        expect(verifyPkceS256(verifier, challengeFor(verifier))).toBe(true);
    });
    it("rejects a mismatched verifier", () => {
        expect(verifyPkceS256("wrong-verifier", challengeFor("right-verifier"))).toBe(false);
    });
    it("rejects empty input", () => {
        expect(verifyPkceS256("", "")).toBe(false);
    });
});
describe("WorkBuddy redirect URIs", () => {
    it("accepts the WorkBuddy private callback", () => {
        const uri = `workbuddy://workbuddy/mcp/connector%3A${process.env.WORKBUDDY_SOURCE || "heyah-family-education"}/oauth/callback`;
        expect(isAllowedWorkbuddyRedirectUri(uri)).toBe(true);
    });
    it("accepts a loopback callback", () => {
        expect(isAllowedWorkbuddyRedirectUri("http://127.0.0.1:53682/oauth/callback")).toBe(true);
        expect(isAllowedWorkbuddyRedirectUri("http://localhost:41234/oauth/callback")).toBe(true);
    });
    it("rejects arbitrary hosts and private callbacks of other connectors", () => {
        expect(isAllowedWorkbuddyRedirectUri("https://evil.example.com/oauth/callback")).toBe(false);
        expect(isAllowedWorkbuddyRedirectUri("workbuddy://workbuddy/mcp/connector%3Aother/oauth/callback")).toBe(false);
        expect(isAllowedWorkbuddyRedirectUri("http://127.0.0.1:53682/other/callback")).toBe(false);
    });
});
describe("opaque token hashing", () => {
    it("is deterministic and never stores the raw value", () => {
        const raw = "heya_at_example";
        expect(hashOpaque(raw)).toBe(hashOpaque(raw));
        expect(hashOpaque(raw)).not.toContain(raw);
        expect(hashOpaque(raw)).toHaveLength(64);
    });
});
