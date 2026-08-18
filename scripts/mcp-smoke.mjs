import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.env.BASE_URL || "http://49.234.4.212/family-edu";
const token = process.env.MCP_SMOKE_TOKEN;

if (!token) {
  console.log("MCP smoke test skipped: MCP_SMOKE_TOKEN is not set");
  process.exit(0);
}

const client = new Client({ name: "family-edu-smoke", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { "X-MCP-Token": token } },
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  const required = [
    "get_sync_spec",
    "list_children",
    "save_wrong_question",
    "list_wrong_questions",
    "get_wrong_question",
    "update_wrong_question",
    "delete_wrong_question",
    "update_wrong_question_status",
    "recalculate_wrong_question_mastery",
    "get_wrong_question_practice_context",
    "create_practice_paper",
    "list_practice_papers",
    "get_practice_paper",
    "update_practice_paper",
    "delete_practice_paper",
    "save_remediation_plan",
    "list_remediation_plans",
    "get_remediation_plan",
    "update_remediation_plan",
    "update_remediation_task_status",
    "delete_remediation_plan",
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`missing MCP tools: ${missing.join(", ")}`);
  const spec = await client.callTool({ name: "get_sync_spec", arguments: {} });
  const text = spec.content?.find((item) => item.type === "text")?.text || "";
  if (!text.includes('"version": "2.2"') || !text.includes("wrong_book_capture")) {
    throw new Error("get_sync_spec did not return the wrong-book v2.2 workflow");
  }
  for (const name of ["list_wrong_questions", "list_practice_papers", "list_remediation_plans"]) {
    const result = await client.callTool({ name, arguments: { limit: 1, offset: 0 } });
    if (result.isError) throw new Error(`${name} returned an MCP error`);
  }
  console.log(`MCP smoke test passed: ${listed.tools.length} tools, wrong-book workflows available`);
} finally {
  await client.close().catch(() => {});
}
