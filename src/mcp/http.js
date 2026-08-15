import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

export async function registerMcpHttp(app) {
  async function handleMcpRequest(req, res, parsedBody) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    transport.onerror = (error) => {
      console.error("[family-edu-agent mcp transport error]", error);
    };
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    try {
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error("[family-edu-agent mcp post]", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
      else res.end();
    } finally {
      res.once("close", () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
    }
  }

  app.post("/mcp", async (req, res) => {
    await handleMcpRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    await handleMcpRequest(req, res);
  });
}
