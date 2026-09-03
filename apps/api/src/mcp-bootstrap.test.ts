import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("./prisma.js", () => ({
  prisma: {
    family: { findUnique: vi.fn().mockResolvedValue({ name: "测试家庭" }) },
    child: { findMany: vi.fn().mockResolvedValue([{ id: "child-1", name: "JOJO", age: 8, grade: "三年级" }]) },
    record: { count: vi.fn().mockResolvedValue(3) },
    report: { count: vi.fn().mockResolvedValue(1) },
    textbook: { count: vi.fn().mockResolvedValue(2) },
    homework: { count: vi.fn().mockResolvedValue(4) },
    knowledgeItem: { count: vi.fn().mockResolvedValue(5) },
    wrongQuestionEntry: { count: vi.fn().mockResolvedValue(6) },
  },
}));

const { createEducationMcpServer } = await import("./mcp.js");

let closeAll: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeAll?.();
  closeAll = undefined;
});

describe("MCP agent bootstrap", () => {
  it("is discoverable and returns structured family context", async () => {
    const server = createEducationMcpServer("family-1");
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeAll = async () => {
      await client.close();
      await server.close();
    };

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("get_agent_bootstrap");

    const result = await client.callTool({ name: "get_agent_bootstrap", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      product: "禾芽家庭教务",
      agent_role: "禾芽家庭私教",
      family: { authenticated: true, name: "测试家庭", identity_source: "X-MCP-Token" },
      children: [{ child_id: "child-1", name: "JOJO" }],
      stats: { wrong_question_count: 6 },
    });
  });
});
