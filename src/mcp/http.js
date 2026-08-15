import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

export async function registerMcpHttp(app) {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);

  app.post("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[family-edu-agent mcp post]", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
      else res.end();
    }
  });

  app.get("/mcp", async (req, res) => {
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[family-edu-agent mcp get]", error);
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
      else res.end();
    }
  });

  return transport;
}
