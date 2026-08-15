import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { seedIfEmpty } from "../store.js";
import { createMcpServer } from "./server.js";

seedIfEmpty();
const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
