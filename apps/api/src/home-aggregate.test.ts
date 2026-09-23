import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subjectOverview: vi.fn(),
  priorities: vi.fn(),
  planningRequest: vi.fn(),
  insights: vi.fn(),
}));

vi.mock("./v2/subject-overview.js", () => ({ getSubjectOverview: mocks.subjectOverview, getSubjectDetail: vi.fn() }));
vi.mock("./v2/learning-engine.js", () => ({
  getLearningPriorities: mocks.priorities,
  ensurePlanningRequest: mocks.planningRequest,
}));
vi.mock("./mobile-home.js", () => ({ loadMobileHomeInsights: mocks.insights }));

const { loadHomeAggregate } = await import("./home-aggregate.js");

describe("home aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subjectOverview.mockResolvedValue({
      overall: { conclusion: "数学需要优先处理", metrics: { subject_count: 1, mastery_average: 58, review_due_count: 1 } },
      subjects: [{ subject: "数学", status: "focus" }, { subject: "语文", status: "thin" }],
    });
    mocks.priorities.mockResolvedValue({
      priorities: [{ label: "两步应用题", subject: "数学", reason: "重复出错" }],
      signal_count: 2,
      planning_required: true,
      active_goal: null,
    });
    mocks.planningRequest.mockResolvedValue({
      id: "plan-1",
      status: "pending",
      triggerReason: "数学出现重复错误",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    mocks.insights.mockResolvedValue({
      child_state: { summary: { evidence_7d: 4 } },
      relationship: null,
      wrong_questions: { items: [], total: 0 },
      mastery: { items: [], total: 0 },
    });
  });

  it("按登录家庭聚合首页学情，并把学科概览交给两端共用", async () => {
    const result = await loadHomeAggregate("family-1", "child-1");

    expect(mocks.subjectOverview).toHaveBeenCalledWith("family-1", "child-1");
    expect(mocks.priorities).toHaveBeenCalledWith("family-1", "child-1", { limit: 3 });
    expect(mocks.planningRequest).toHaveBeenCalledWith("family-1", "child-1");
    expect(mocks.insights).toHaveBeenCalledWith("family-1", "child-1");

    expect(result).toMatchObject({
      child_state: { summary: { evidence_7d: 4 } },
      learning_priorities: { top: { label: "两步应用题" }, signal_count: 2, planning_required: true },
      planning_request: { id: "plan-1", trigger_reason: "数学出现重复错误" },
      subject_overview: { subjects: [{ subject: "数学" }, { subject: "语文" }] },
    });
  });

  it("没有孩子时不查孩子维度数据，返回真实空状态而不是假数据", async () => {
    mocks.insights.mockResolvedValue({ child_state: null, relationship: null, wrong_questions: { items: [], total: 0 }, mastery: { items: [], total: 0 } });

    const result = await loadHomeAggregate("family-1", null);

    expect(mocks.subjectOverview).not.toHaveBeenCalled();
    expect(mocks.priorities).not.toHaveBeenCalled();
    expect(mocks.planningRequest).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      child_state: null,
      learning_priorities: null,
      planning_request: null,
      subject_overview: null,
    });
  });

  it("学科概览算不出来时不影响首页其它数据", async () => {
    mocks.subjectOverview.mockRejectedValue(new Error("overview unavailable"));

    const result = await loadHomeAggregate("family-1", "child-1");

    expect((result as any).subject_overview).toBeNull();
    expect((result as any).planning_request).toMatchObject({ id: "plan-1" });
    expect((result as any).child_state).toMatchObject({ summary: { evidence_7d: 4 } });
  });

  it("待规划事项算不出来时学科概览照常返回", async () => {
    mocks.priorities.mockRejectedValue(new Error("learning engine unavailable"));

    const result = await loadHomeAggregate("family-1", "child-1");

    expect((result as any).learning_priorities).toBeNull();
    expect((result as any).planning_request).toBeNull();
    expect((result as any).subject_overview).toMatchObject({ overall: { conclusion: "数学需要优先处理" } });
  });
});
