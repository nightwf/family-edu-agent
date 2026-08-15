import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { listEducationSkills, getEducationSkill, getCoachingPolicy, buildChildContext } from "./education.js";
function textResult(payload) {
    return {
        content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    };
}
export function createEducationMcpServer() {
    const server = new McpServer({ name: "family-edu-mcp", version: "2.0.0" });
    server.tool("list_education_skills", "读取项目内置的教育 Skill 列表。", {}, async () => textResult(listEducationSkills()));
    server.tool("get_education_skill", { skill_id: z.string() }, async ({ skill_id }) => {
        const skill = getEducationSkill(skill_id);
        return skill ? textResult(skill) : textResult({ error: "education skill not found" });
    });
    server.tool("get_coaching_policy", { skill_id: z.string() }, async ({ skill_id }) => {
        const policy = getCoachingPolicy(skill_id);
        return policy ? textResult(policy) : textResult({ error: "education skill not found" });
    });
    server.tool("get_child_context", { family_id: z.string().optional(), child_id: z.string() }, async ({ family_id, child_id }) => {
        const familyId = family_id || "family_001";
        const context = await buildChildContext(familyId, child_id);
        return context ? textResult(context) : textResult({ error: "child not found" });
    });
    server.tool("save_knowledge_item", {
        family_id: z.string().optional(),
        child_id: z.string(),
        kind: z.enum(["summary", "report", "suggestion"]).optional(),
        title: z.string(),
        content: z.string(),
    }, async (input) => {
        const item = await prisma.knowledgeItem.create({
            data: {
                familyId: input.family_id || "family_001",
                childId: input.child_id,
                kind: input.kind || "summary",
                title: input.title,
                content: input.content,
                source: "workbuddy",
            },
        });
        return textResult(item);
    });
    server.tool("save_homework", {
        family_id: z.string().optional(),
        child_id: z.string(),
        subject: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        estimated_minutes: z.number().optional(),
        due_date: z.string().optional(),
        priority: z.string().optional(),
    }, async (input) => {
        const homework = await prisma.homework.create({
            data: {
                familyId: input.family_id || "family_001",
                childId: input.child_id,
                subject: input.subject,
                title: input.title,
                description: input.description,
                estimatedMinutes: input.estimated_minutes,
                dueDate: input.due_date ? new Date(input.due_date) : null,
                priority: input.priority || "medium",
            },
        });
        return textResult(homework);
    });
    server.tool("complete_homework", { homework_id: z.string() }, async ({ homework_id }) => {
        const homework = await prisma.homework.update({
            where: { id: homework_id },
            data: { status: "done", completedAt: new Date() },
        });
        return textResult(homework);
    });
    server.tool("import_textbook", {
        family_id: z.string().optional(),
        child_id: z.string(),
        title: z.string(),
        subject: z.string().optional(),
        grade: z.string().optional(),
        publisher: z.string().optional(),
        version: z.string().optional(),
        file_key: z.string().optional(),
    }, async (input) => {
        const textbook = await prisma.textbook.create({
            data: {
                familyId: input.family_id || "family_001",
                childId: input.child_id,
                title: input.title,
                subject: input.subject,
                grade: input.grade,
                publisher: input.publisher,
                version: input.version,
                fileKey: input.file_key,
                chapters: [{ title: "第一单元", knowledgePoints: ["基础概念", "表达训练"] }],
                knowledgePoints: ["基础概念", "表达训练"],
            },
        });
        return textResult(textbook);
    });
    server.tool("get_growth_summary", { child_id: z.string() }, async ({ child_id }) => {
        const [records, reports] = await Promise.all([
            prisma.record.findMany({ where: { childId: child_id }, orderBy: { date: "asc" } }),
            prisma.report.findMany({ where: { childId: child_id }, orderBy: { createdAt: "desc" } }),
        ]);
        return textResult({ child_id, record_count: records.length, records, reports });
    });
    return server;
}
export async function registerMcpHttp(app) {
    app.post("/mcp", async (request, reply) => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        transport.onerror = (error) => app.log.error(error, "mcp transport error");
        const mcpServer = createEducationMcpServer();
        await mcpServer.connect(transport);
        try {
            await transport.handleRequest(request.raw, reply.raw, request.body);
        }
        catch (error) {
            app.log.error(error, "mcp request error");
            if (!reply.sent)
                reply.code(500).send({ error: "MCP request failed" });
        }
        finally {
            reply.raw.once("close", () => {
                transport.close().catch(() => { });
                mcpServer.close().catch(() => { });
            });
        }
    });
    app.get("/mcp", async (request, reply) => {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const mcpServer = createEducationMcpServer();
        await mcpServer.connect(transport);
        await transport.handleRequest(request.raw, reply.raw);
        reply.raw.once("close", () => {
            transport.close().catch(() => { });
            mcpServer.close().catch(() => { });
        });
    });
}
