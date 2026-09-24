import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEducationMcpServer } from "../mcp.js";
import { env } from "../env.js";
import { allowedToolNames, filterChildrenResult, sanitizeToolArguments, type TutorPersona } from "./tool-policy.js";
import type { ToolSchema } from "./llm/types.js";

/**
 * 私教不新写工具，而是以进程内 MCP 客户端身份调用同一个 MCP Server。
 * 好处：工具只有一处定义，WorkBuddy 与私教永远不会分叉；
 * 无 HTTP 回环、无自签令牌，家庭边界沿用 createEducationMcpServer 的既有语义。
 */

export type TutorToolset = {
  /** 暴露给模型的工具：服务端实际注册的工具 ∩ 授权表。 */
  schemas: ToolSchema[];
  callTool(name: string, rawArguments: unknown): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
};

/** 结果超过上限就截断，避免把整本错题本塞进上下文。 */
function truncate(text: string, limit = env.TUTOR_TOOL_RESULT_LIMIT) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（结果过长已截断，共 ${text.length} 字）`;
}

function extractText(result: any): string {
  if (typeof result?.structuredContent !== "undefined") {
    return JSON.stringify(result.structuredContent);
  }
  const parts = Array.isArray(result?.content) ? result.content : [];
  const texts = parts.filter((part: any) => part?.type === "text").map((part: any) => String(part.text ?? ""));
  return texts.join("\n");
}

export async function createTutorToolset(
  familyId: string,
  persona: TutorPersona,
  pinnedChildId?: string | null,
): Promise<TutorToolset> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createEducationMcpServer(familyId);
  const client = new Client({ name: "heya-tutor", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const allowed = new Set(allowedToolNames(persona));
  const discovered = await client.listTools();
  const schemas: ToolSchema[] = discovered.tools
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description || tool.name,
      inputSchema: (tool.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
    }));

  // 只有声明了 child_id 的工具才注入/覆盖该参数，避免给不接受的工具塞多余字段。
  const acceptsChildId = new Set(
    schemas
      .filter((tool) => {
        const properties = (tool.inputSchema as any)?.properties;
        return properties && typeof properties === "object" && "child_id" in properties;
      })
      .map((tool) => tool.name),
  );

  return {
    schemas,

    async callTool(name, rawArguments) {
      if (!allowed.has(name)) {
        // 默认拒绝：既不给模型看，也不执行。
        return { text: `工具 ${name} 未被授权使用`, isError: true };
      }
      const args = sanitizeToolArguments(name, rawArguments, { pinnedChildId }, acceptsChildId.has(name));
      try {
        const result: any = await client.callTool({ name, arguments: args });
        let payload: any = result?.structuredContent;
        if (typeof payload === "undefined") {
          const text = extractText(result);
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
        }
        if (name === "list_children" || name === "list_learning_signals") {
          payload = filterChildrenResult(persona, pinnedChildId || null, payload);
        }
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        return { text: truncate(text), isError: result?.isError === true };
      } catch (error) {
        return { text: `工具调用失败：${(error as Error)?.message || "未知错误"}`, isError: true };
      }
    },

    async close() {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
