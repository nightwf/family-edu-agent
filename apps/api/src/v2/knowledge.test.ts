import { describe, expect, it, vi, beforeEach } from "vitest";

const sourceCreate = vi.fn();
const sourceFindFirst = vi.fn();
const sourceFindMany = vi.fn();
const sourceCount = vi.fn();
const nodeFindMany = vi.fn();
const nodeCount = vi.fn();
const nodeFindFirst = vi.fn();
const nodeCreate = vi.fn();
const relationFindMany = vi.fn();
const relationFindFirst = vi.fn();
const relationCreate = vi.fn();
const relationUpdate = vi.fn();
const stateFindUnique = vi.fn();
const stateUpsert = vi.fn();
const childFindFirst = vi.fn();
const auditCreate = vi.fn();
const transaction = vi.fn();

vi.mock("../prisma.js", () => ({
  prisma: {
    sourceDocument: {
      create: sourceCreate,
      findFirst: sourceFindFirst,
      findMany: sourceFindMany,
      count: sourceCount,
    },
    knowledgeNode: {
      create: nodeCreate,
      findFirst: nodeFindFirst,
      findMany: nodeFindMany,
      count: nodeCount,
    },
    knowledgeRelation: { findMany: relationFindMany, findFirst: relationFindFirst, create: relationCreate, update: relationUpdate },
    childKnowledgeState: { findUnique: stateFindUnique, upsert: stateUpsert },
    child: { findFirst: childFindFirst },
    auditLog: { create: auditCreate },
    $transaction: transaction,
  },
}));

const {
  importSourceDocument,
  saveKnowledgeRelationsBatch,
  getKnowledgeContext,
  upsertChildKnowledgeState,
} = await import("./knowledge.js");

describe("knowledge v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceCreate.mockImplementation(async ({ data }) => ({ id: "source-1", ...data, nodes: [] }));
    sourceFindFirst.mockResolvedValue({ id: "source-1", familyId: "family-1", version: "1.0.0" });
    sourceFindMany.mockResolvedValue([]);
    sourceCount.mockResolvedValue(0);
    nodeFindMany.mockResolvedValue([]);
    nodeCount.mockResolvedValue(0);
    nodeFindFirst.mockResolvedValue({ id: "node-1", familyId: "family-1", status: "ACTIVE" });
    nodeCreate.mockImplementation(async ({ data }) => ({ id: "node-1", ...data }));
    relationFindMany.mockResolvedValue([]);
    relationFindFirst.mockResolvedValue(null);
    relationCreate.mockImplementation(async ({ data }) => ({ id: "relation-1", ...data }));
    relationUpdate.mockImplementation(async ({ data }) => ({ id: "relation-1", ...data }));
    stateFindUnique.mockResolvedValue(null);
    stateUpsert.mockImplementation(async ({ create, update }) => ({ id: "state-1", ...(create || update) }));
    childFindFirst.mockResolvedValue({ id: "child-1", familyId: "family-1", grade: "三年级", subjects: ["数学"] });
    auditCreate.mockResolvedValue({ id: "audit-1" });
    transaction.mockImplementation(async (items) => Promise.all(items));
  });

  it("imports a source document with knowledge nodes", async () => {
    await importSourceDocument("family-1", {
      title: "三年级上册数学",
      kind: "textbook",
      subject: "数学",
      nodes: [
        {
          type: "KNOWLEDGE_POINT",
          title: "退位减法",
          evidence: ["能独立完成退位减法竖式", "能说明十位借一的过程"],
          assessmentPrompt: "如果孩子说 52 - 38，能否说明为什么要先拆十位？",
          commonErrors: [{ error: "忘记退位后十位少 1", correction: "先用小棒或竖式演示" }],
        },
      ],
    });
    expect(sourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: "family-1",
          nodes: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                title: "退位减法",
                evidence: expect.any(Array),
                assessmentPrompt: expect.any(String),
                commonErrors: expect.any(Array),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("saves prerequisite relations with hard/soft strength and reason", async () => {
    await saveKnowledgeRelationsBatch(
      "family-1",
      "source-1",
      [
        {
          prerequisiteTitle: "20 以内退位减法",
          dependentTitle: "万以内退位减法",
          strength: "hard",
          reason: "需要先理解借位规则，再迁移到多位数竖式",
        },
      ],
    );
    expect(sourceFindFirst).toHaveBeenCalled();
    expect(nodeFindFirst).toHaveBeenCalledTimes(2);
    expect(relationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: "family-1",
          relationType: "PREREQUISITE_OF",
          strength: "hard",
          reason: "需要先理解借位规则，再迁移到多位数竖式",
        }),
      }),
    );
  });

  it("updates an existing knowledge relation instead of creating a duplicate", async () => {
    relationFindFirst.mockResolvedValue({ id: "relation-1", strength: "hard" });
    await saveKnowledgeRelationsBatch("family-1", "source-1", [
      {
        prerequisiteTitle: "加法含义",
        dependentTitle: "乘法含义",
        strength: "soft",
        reason: "建议先理解加法，乘法讲解更容易被接受",
      },
    ]);
    expect(relationCreate).not.toHaveBeenCalled();
    expect(relationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "relation-1" },
        data: expect.objectContaining({
          strength: "soft",
          reason: "建议先理解加法，乘法讲解更容易被接受",
        }),
      }),
    );
  });

  it("builds knowledge context with prerequisites and child state", async () => {
    relationFindMany.mockResolvedValue([
      {
        id: "relation-1",
        relationType: "PREREQUISITE_OF",
        strength: "hard",
        reason: "需要先理解个位计算",
        sourceNode: {
          id: "node-prereq",
          title: "个位减法",
          evidence: ["能完成 9-5"],
          assessmentPrompt: "9 减 5 等于几？",
          commonErrors: null,
        },
      },
    ]);
    const context = await getKnowledgeContext("family-1", "child-1", "node-1");
    expect(context.child.id).toBe("child-1");
    expect(context.node.id).toBe("node-1");
    expect(relationFindMany).toHaveBeenCalled();
    expect(context.prerequisites[0]).toMatchObject({
      title: "个位减法",
      relationStrength: "hard",
      relationReason: "需要先理解个位计算",
    });
    expect(stateFindUnique).toHaveBeenCalled();
  });

  it("validates family ownership before writing child knowledge state", async () => {
    childFindFirst.mockResolvedValue(null);
    await expect(
      upsertChildKnowledgeState("family-1", {
        childId: "child-other",
        knowledgeNodeId: "node-1",
      }),
    ).rejects.toThrow("学生不存在或不属于当前家庭");
  });
});
