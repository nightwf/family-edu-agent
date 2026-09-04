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
        knowledgeRelation: { findMany: relationFindMany },
        childKnowledgeState: { findUnique: stateFindUnique, upsert: stateUpsert },
        child: { findFirst: childFindFirst },
        auditLog: { create: auditCreate },
        $transaction: transaction,
    },
}));
const { importSourceDocument, getKnowledgeContext, upsertChildKnowledgeState } = await import("./knowledge.js");
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
            nodes: [{ type: "KNOWLEDGE_POINT", title: "退位减法" }],
        });
        expect(sourceCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                familyId: "family-1",
                nodes: expect.any(Object),
            }),
        }));
    });
    it("builds knowledge context with prerequisites and child state", async () => {
        const context = await getKnowledgeContext("family-1", "child-1", "node-1");
        expect(context.child.id).toBe("child-1");
        expect(context.node.id).toBe("node-1");
        expect(relationFindMany).toHaveBeenCalled();
        expect(stateFindUnique).toHaveBeenCalled();
    });
    it("validates family ownership before writing child knowledge state", async () => {
        childFindFirst.mockResolvedValue(null);
        await expect(upsertChildKnowledgeState("family-1", {
            childId: "child-other",
            knowledgeNodeId: "node-1",
        })).rejects.toThrow("学生不存在或不属于当前家庭");
    });
});
