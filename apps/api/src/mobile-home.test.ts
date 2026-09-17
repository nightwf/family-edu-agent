import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  childState: vi.fn(),
  relationship: vi.fn(),
  wrongQuestions: vi.fn(),
  mastery: vi.fn(),
}));

vi.mock("./v2/child-state.js", () => ({ getChildState: mocks.childState }));
vi.mock("./v2/relationship.js", () => ({ getLatestRelationship: mocks.relationship }));
vi.mock("./wrong-book.js", () => ({ listWrongQuestions: mocks.wrongQuestions }));
vi.mock("./question-bank.js", () => ({ listStudentMastery: mocks.mastery }));

const { loadMobileHomeInsights } = await import("./mobile-home.js");

describe("mobile home aggregate insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.childState.mockResolvedValue({ summary: { evidence_7d: 2 } });
    mocks.relationship.mockResolvedValue({ status: "stable" });
    mocks.wrongQuestions.mockResolvedValue({ items: [{ id: "wrong-1" }], total: 1 });
    mocks.mastery.mockResolvedValue({ items: [{ id: "mastery-1" }], total: 1 });
  });

  it("uses the authenticated family for every child insight query", async () => {
    const result = await loadMobileHomeInsights("family-1", "child-1");

    expect(mocks.childState).toHaveBeenCalledWith("family-1", "child-1");
    expect(mocks.relationship).toHaveBeenCalledWith("family-1", "child-1");
    expect(mocks.wrongQuestions).toHaveBeenCalledWith("family-1", { child_id: "child-1", limit: 5, offset: 0 });
    expect(mocks.mastery).toHaveBeenCalledWith("family-1", { child_id: "child-1", limit: 20, offset: 0 });
    expect(result).toMatchObject({
      child_state: { summary: { evidence_7d: 2 } },
      relationship: { status: "stable" },
      wrong_questions: { total: 1 },
      mastery: { total: 1 },
    });
  });

  it("returns a real empty aggregate when the family has no child", async () => {
    const result = await loadMobileHomeInsights("family-1", null);

    expect(result).toEqual({
      child_state: null,
      relationship: null,
      wrong_questions: { items: [], total: 0 },
      mastery: { items: [], total: 0 },
    });
    expect(mocks.childState).not.toHaveBeenCalled();
  });

  it("keeps the basic home available when an optional insight query fails", async () => {
    mocks.relationship.mockRejectedValue(new Error("optional table unavailable"));
    const result = await loadMobileHomeInsights("family-1", "child-1");
    expect(result.relationship).toBeNull();
    expect(result.child_state).toMatchObject({ summary: { evidence_7d: 2 } });
    expect(result.wrong_questions).toMatchObject({ total: 1 });
  });
});
