import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMessage = vi.fn();
const findUniqueConversation = vi.fn();
const updateConversation = vi.fn();
const findFirstEvidence = vi.fn();
const createEvidence = vi.fn();

vi.mock("../prisma.js", () => ({
  prisma: {
    tutorMessage: { findMany: (...args: unknown[]) => findManyMessage(...args) },
    tutorConversation: {
      findUnique: (...args: unknown[]) => findUniqueConversation(...args),
      update: (...args: unknown[]) => updateConversation(...args),
    },
    evidenceRecord: { findFirst: (...args: unknown[]) => findFirstEvidence(...args) },
  },
}));

vi.mock("../v2/evidence.js", () => ({
  createEvidenceRecord: (...args: unknown[]) => createEvidence(...args),
}));

const { buildHistory, draftFromTurn, extractEvidence, needsSummarize, summarizeConversation } = await import("./memory.js");

beforeEach(() => {
  findManyMessage.mockReset();
  findUniqueConversation.mockReset();
  updateConversation.mockReset();
  findFirstEvidence.mockReset();
  createEvidence.mockReset();
});

describe("短期记忆：上下文窗口", () => {
  it("按时间正序返回最近若干轮", async () => {
    // 查询是倒序取，函数应翻回正序
    findManyMessage.mockResolvedValue([
      { role: "assistant", content: "第二句" },
      { role: "user", content: "第一句" },
    ]);
    const history = await buildHistory("conv-1", 5);
    expect(history.map((message) => message.content)).toEqual(["第一句", "第二句"]);
  });

  it("过滤掉空白消息，避免把空轮次喂进模型", async () => {
    findManyMessage.mockResolvedValue([
      { role: "assistant", content: "   " },
      { role: "user", content: "有内容" },
    ]);
    const history = await buildHistory("conv-1", 5);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("有内容");
  });
});

describe("中期记忆：摘要", () => {
  it("超过窗口才需要重算", () => {
    expect(needsSummarize(2)).toBe(false);
    expect(needsSummarize(999)).toBe(true);
  });

  it("生成摘要并写回会话", async () => {
    findUniqueConversation.mockResolvedValue({ id: "conv-1" });
    findManyMessage.mockResolvedValue([
      { role: "user", content: "这题怎么做", createdAt: new Date() },
      { role: "assistant", content: "先看条件", createdAt: new Date() },
    ]);
    updateConversation.mockResolvedValue({});

    const summary = await summarizeConversation("conv-1");
    expect(summary).toContain("共 2 条消息");
    expect(summary).toContain("这题怎么做");
    expect(updateConversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conv-1" } }));
  });

  it("没有会话时返回 null，不写库", async () => {
    findUniqueConversation.mockResolvedValue(null);
    expect(await summarizeConversation("nope")).toBeNull();
    expect(updateConversation).not.toHaveBeenCalled();
  });
});

describe("长期记忆：证据回流", () => {
  it("写入时为待确认状态，来源标为 tutor", async () => {
    findFirstEvidence.mockResolvedValue(null);
    createEvidence.mockResolvedValue({ id: "e1", reviewStatus: "PENDING_CONFIRMATION" });

    const result = await extractEvidence({
      familyId: "family-1",
      childId: "child-1",
      conversationId: "conv-1",
      draft: { type: "PARENT_NOTE", observedBehavior: "[私教对话] 今天问了进位加法" },
      actorId: "user-1",
    });

    expect(result).toMatchObject({ id: "e1" });
    expect(createEvidence).toHaveBeenCalledWith(
      "family-1",
      expect.objectContaining({ childId: "child-1", source: "tutor", sourceRef: "conv-1" }),
      { type: "tutor", id: "user-1" },
    );
  });

  it("24 小时内完全相同的记录不重复写", async () => {
    findFirstEvidence.mockResolvedValue({ id: "e0", observedBehavior: "[私教对话] 今天问了进位加法" });
    const result = await extractEvidence({
      familyId: "family-1",
      childId: "child-1",
      conversationId: "conv-1",
      draft: { type: "PARENT_NOTE", observedBehavior: "[私教对话] 今天问了进位加法" },
    });
    expect(result).toBeNull();
    expect(createEvidence).not.toHaveBeenCalled();
  });

  it("空内容不写库", async () => {
    const result = await extractEvidence({
      familyId: "family-1",
      childId: "child-1",
      conversationId: "conv-1",
      draft: { type: "PARENT_NOTE", observedBehavior: "  " },
    });
    expect(result).toBeNull();
    expect(createEvidence).not.toHaveBeenCalled();
  });

  it("从一轮对话生成草稿，且不臆造孩子做过的事", () => {
    const draft = draftFromTurn("这题我算成 15 了", "我们一起看看");
    expect(draft?.observedBehavior).toContain("这题我算成 15 了");
    expect(draft?.type).toBe("PARENT_NOTE");
    expect(draftFromTurn("", "")).toBeNull();
  });
});
