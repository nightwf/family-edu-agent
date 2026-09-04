import { describe, expect, it, vi, beforeEach } from "vitest";
const upsert = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
const methodEffectCreate = vi.fn();
const childFindFirst = vi.fn();
const auditCreate = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        educationMethod: { upsert, findMany, findUnique },
        methodEffect: { create: methodEffectCreate },
        child: { findFirst: childFindFirst },
        auditLog: { create: auditCreate },
    },
}));
const { ensureEducationMethods, listEducationMethods, saveMethodEffect } = await import("./education-methods-v2.js");
describe("education methods v2", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        upsert.mockResolvedValue({});
        findMany.mockResolvedValue([]);
        findUnique.mockResolvedValue({ id: "method-1", key: "warm-and-structured" });
        childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1" });
        methodEffectCreate.mockImplementation(async ({ data }) => ({ id: "effect-1", ...data }));
        auditCreate.mockResolvedValue({ id: "audit-1" });
    });
    it("seeds both core and scenario methods", async () => {
        await ensureEducationMethods();
        expect(upsert).toHaveBeenCalledTimes(6);
    });
    it("defaults method queries to active methods", async () => {
        await listEducationMethods();
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: "ACTIVE" }),
        }));
    });
    it("saves a method effect after validating child and method", async () => {
        const effect = await saveMethodEffect("family-1", {
            childId: "child-1",
            methodId: "method-1",
            outcome: "正确率提升",
            confidence: 0.8,
        });
        expect(effect.outcome).toBe("正确率提升");
        expect(auditCreate).toHaveBeenCalledOnce();
    });
});
