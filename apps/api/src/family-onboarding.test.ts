import { describe, expect, it, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const upsert = vi.fn();
const getActiveFamilyMember = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: {
    family: { findUnique },
    familyJoinRequest: { upsert },
  },
}));

vi.mock("./family-members.js", () => ({
  getActiveFamilyMember,
  ensureFamilyMember: vi.fn(),
}));

const { applyToFamilyByJoinCode } = await import("./family-onboarding.js");

describe("family join by 6-digit code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects codes that are not six digits", async () => {
    await expect(applyToFamilyByJoinCode("user-1", "12345")).rejects.toThrow("请输入正确的 6 位家庭编码");
    await expect(applyToFamilyByJoinCode("user-1", "abcdef")).rejects.toThrow("请输入正确的 6 位家庭编码");
    await expect(applyToFamilyByJoinCode("user-1", "")).rejects.toThrow("请输入正确的 6 位家庭编码");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects an unknown code", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(applyToFamilyByJoinCode("user-1", "123456")).rejects.toThrow("家庭编码不存在");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("returns an existing membership without creating a duplicate request", async () => {
    findUnique.mockResolvedValueOnce({ id: "family-1", name: "JOJO 的家" });
    getActiveFamilyMember.mockResolvedValueOnce({ id: "member-1" });
    const result = await applyToFamilyByJoinCode("user-1", "123456");
    expect(result.already_member).toBe(true);
    expect(result.request).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("creates a pending request instead of granting access", async () => {
    findUnique.mockResolvedValueOnce({ id: "family-1", name: "JOJO 的家" });
    getActiveFamilyMember.mockResolvedValueOnce(null);
    upsert.mockResolvedValueOnce({ id: "request-1", status: "pending" });
    const result = await applyToFamilyByJoinCode("user-1", "123456");
    expect(result.already_member).toBe(false);
    expect(result.request).toMatchObject({ id: "request-1", status: "pending" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ familyId: "family-1", userId: "user-1", status: "pending" }),
    }));
  });
});
