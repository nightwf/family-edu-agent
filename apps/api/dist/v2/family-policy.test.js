import { describe, expect, it, vi, beforeEach } from "vitest";
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const policyChangeCreate = vi.fn();
const auditCreate = vi.fn();
vi.mock("../prisma.js", () => ({
    prisma: {
        familyPolicy: { findUnique, create, update },
        policyChange: { create: policyChangeCreate },
        auditLog: { create: auditCreate },
    },
}));
const { getFamilyPolicy, updateFamilyPolicy } = await import("./family-policy.js");
describe("family policy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findUnique.mockResolvedValue(null);
        create.mockImplementation(async ({ data }) => ({ id: "policy-1", ...data }));
        update.mockImplementation(async ({ data }) => ({ id: "policy-1", ...data }));
        policyChangeCreate.mockResolvedValue({ id: "change-1" });
        auditCreate.mockResolvedValue({ id: "audit-1" });
    });
    it("creates a default policy when none exists", async () => {
        const policy = await getFamilyPolicy("family-1");
        expect(create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                familyId: "family-1",
                prioritySubjects: [],
                parentGoals: [],
            }),
        });
        expect(policy.familyId).toBe("family-1");
    });
    it("increments policy version and writes change and audit records", async () => {
        findUnique.mockResolvedValue({ id: "policy-1", familyId: "family-1", version: 2 });
        update.mockResolvedValue({ id: "policy-1", familyId: "family-1", version: 3, parentGoals: ["数学优先"] });
        const result = await updateFamilyPolicy("family-1", { parentGoals: ["数学优先"] }, { type: "parent", id: "user-1" });
        expect(update).toHaveBeenCalledWith({
            where: { familyId: "family-1" },
            data: expect.objectContaining({ version: 3, parentGoals: ["数学优先"] }),
        });
        expect(policyChangeCreate).toHaveBeenCalledOnce();
        expect(auditCreate).toHaveBeenCalledOnce();
        expect(result.version).toBe(3);
    });
});
