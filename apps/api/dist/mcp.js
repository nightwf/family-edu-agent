import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { prisma } from "./prisma.js";
import { listEducationSkills, getEducationSkill, getCoachingPolicy, buildChildContext } from "./education.js";
import { env } from "./env.js";
import { listFamilyPolicies, getEffectiveSkill, updateFamilyProfile, proposePolicyChange, reviewPolicyChange, getPolicyHistory, } from "./personalization.js";
function textResult(payload) {
    return {
        content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    };
}
export function createEducationMcpServer(familyId = env.MCP_FAMILY_ID) {
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
    server.tool("list_family_policies", { family_id: z.string().optional() }, async ({ family_id }) => {
        return textResult(await listFamilyPolicies(family_id || familyId));
    });
    server.tool("get_effective_skill", {
        family_id: z.string().optional(),
        skill_id: z.string(),
    }, async ({ family_id, skill_id }) => {
        const effective = await getEffectiveSkill(family_id || familyId, skill_id);
        return effective ? textResult(effective) : textResult({ error: "education skill not found" });
    });
    server.tool("update_family_policy", {
        family_id: z.string().optional(),
        skill_id: z.string(),
        philosophy: z.string().optional(),
        communication_style: z.string().optional(),
        strictness: z.string().optional(),
        parent_goals: z.array(z.string()).optional(),
    }, async (input) => {
        const profile = await updateFamilyProfile(input.family_id || familyId, input.skill_id, {
            philosophy: input.philosophy,
            communicationStyle: input.communication_style,
            strictness: input.strictness,
            parentGoals: input.parent_goals,
        }, "workbuddy");
        return textResult(profile);
    });
    server.tool("propose_policy_change", {
        family_id: z.string().optional(),
        skill_id: z.string(),
        type: z.string(),
        summary: z.string().optional(),
        reason: z.string().optional(),
        after: z.record(z.any()).optional(),
    }, async (input) => {
        const change = await proposePolicyChange(input.family_id || familyId, input.skill_id, {
            type: input.type,
            summary: input.summary,
            reason: input.reason,
            after: input.after,
        }, "workbuddy");
        return textResult(change);
    });
    server.tool("review_policy_change", {
        change_id: z.string(),
        action: z.enum(["approved", "ignored"]),
    }, async ({ change_id, action }) => {
        return textResult(await reviewPolicyChange(change_id, action, "parent"));
    });
    server.tool("get_policy_history", {
        family_id: z.string().optional(),
        skill_id: z.string().optional(),
    }, async ({ family_id, skill_id }) => {
        return textResult(await getPolicyHistory(family_id || familyId, skill_id));
    });
    server.tool("list_children", { family_id: z.string().optional() }, async ({ family_id }) => {
        const children = await prisma.child.findMany({
            where: { familyId: family_id || familyId, status: "active" },
            orderBy: { createdAt: "asc" },
        });
        return textResult(children);
    });
    server.tool("get_family_summary", { family_id: z.string().optional() }, async ({ family_id }) => {
        const activeFamilyId = family_id || familyId;
        const children = await prisma.child.findMany({
            where: { familyId: activeFamilyId, status: "active" },
            orderBy: { createdAt: "asc" },
        });
        const records = await prisma.record.count({ where: { familyId: activeFamilyId } });
        const textbooks = await prisma.textbook.count({ where: { familyId: activeFamilyId } });
        const knowledge = await prisma.knowledgeItem.count({ where: { familyId: activeFamilyId } });
        return textResult({
            family_id: activeFamilyId,
            children: children.map((child) => ({ child_id: child.id, name: child.name, grade: child.grade })),
            record_count: records,
            textbook_count: textbooks,
            knowledge_count: knowledge,
        });
    });
    server.tool("create_child", {
        family_id: z.string().optional(),
        name: z.string(),
        age: z.number().optional(),
        grade: z.string(),
        subjects: z.array(z.string()).optional(),
        textbook_version: z.string().optional(),
    }, async (input) => {
        const child = await prisma.child.create({
            data: {
                familyId: input.family_id || familyId,
                name: input.name,
                age: input.age,
                grade: input.grade,
                subjects: input.subjects || [],
                textbookVersion: input.textbook_version,
            },
        });
        return textResult(child);
    });
    server.tool("update_child", {
        child_id: z.string(),
        name: z.string().optional(),
        age: z.number().optional(),
        grade: z.string().optional(),
        subjects: z.array(z.string()).optional(),
        textbook_version: z.string().optional(),
        status: z.string().optional(),
    }, async (input) => {
        const child = await prisma.child.update({
            where: { id: input.child_id },
            data: {
                name: input.name,
                age: input.age,
                grade: input.grade,
                subjects: input.subjects,
                textbookVersion: input.textbook_version,
                status: input.status,
            },
        });
        return textResult(child);
    });
    server.tool("delete_child", { child_id: z.string() }, async ({ child_id }) => {
        await prisma.child.delete({ where: { id: child_id } });
        return textResult({ ok: true, child_id });
    });
    server.tool("get_child_context", { family_id: z.string().optional(), child_id: z.string() }, async ({ family_id, child_id }) => {
        const activeFamilyId = family_id || familyId;
        const context = await buildChildContext(activeFamilyId, child_id);
        return context ? textResult(context) : textResult({ error: "child not found" });
    });
    server.tool("save_learning_record", {
        family_id: z.string().optional(),
        child_id: z.string(),
        type: z.enum(["writing", "reading", "homework", "parent_note"]),
        title: z.string(),
        date: z.string().optional(),
        content: z.string().optional(),
        score: z.number().optional(),
        notes: z.string().optional(),
    }, async (input) => {
        const record = await prisma.record.create({
            data: {
                familyId: input.family_id || familyId,
                childId: input.child_id,
                type: input.type,
                title: input.title,
                date: input.date ? new Date(input.date) : new Date(),
                content: input.content,
                score: input.score,
                notes: input.notes,
            },
        });
        return textResult(record);
    });
    server.tool("save_writing_record", {
        family_id: z.string().optional(),
        child_id: z.string(),
        title: z.string(),
        date: z.string().optional(),
        content: z.string().optional(),
        score: z.number().optional(),
        notes: z.string().optional(),
    }, async (input) => {
        const record = await prisma.record.create({
            data: {
                familyId: input.family_id || familyId,
                childId: input.child_id,
                type: "writing",
                title: input.title,
                date: input.date ? new Date(input.date) : new Date(),
                content: input.content,
                score: input.score,
                notes: input.notes,
            },
        });
        return textResult(record);
    });
    server.tool("save_reading_record", {
        family_id: z.string().optional(),
        child_id: z.string(),
        title: z.string(),
        date: z.string().optional(),
        content: z.string().optional(),
        score: z.number().optional(),
        notes: z.string().optional(),
    }, async (input) => {
        const record = await prisma.record.create({
            data: {
                familyId: input.family_id || familyId,
                childId: input.child_id,
                type: "reading",
                title: input.title,
                date: input.date ? new Date(input.date) : new Date(),
                content: input.content,
                score: input.score,
                notes: input.notes,
            },
        });
        return textResult(record);
    });
    server.tool("get_learning_history", {
        child_id: z.string(),
        type: z.string().optional(),
    }, async ({ child_id, type }) => {
        const records = await prisma.record.findMany({
            where: { childId: child_id, ...(type ? { type } : {}) },
            orderBy: { date: "desc" },
        });
        return textResult(records);
    });
    server.tool("update_record", {
        record_id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        score: z.number().optional(),
        notes: z.string().optional(),
        type: z.string().optional(),
    }, async ({ record_id, ...data }) => {
        const record = await prisma.record.update({ where: { id: record_id }, data });
        return textResult(record);
    });
    server.tool("delete_record", { record_id: z.string() }, async ({ record_id }) => {
        await prisma.record.delete({ where: { id: record_id } });
        return textResult({ ok: true, record_id });
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
                familyId: input.family_id || familyId,
                childId: input.child_id,
                kind: input.kind || "summary",
                title: input.title,
                content: input.content,
                source: "workbuddy",
            },
        });
        return textResult(item);
    });
    server.tool("delete_knowledge_item", { item_id: z.string() }, async ({ item_id }) => {
        await prisma.knowledgeItem.delete({ where: { id: item_id } });
        return textResult({ ok: true, item_id });
    });
    server.tool("list_knowledge_items", {
        family_id: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ family_id, child_id }) => {
        const activeFamilyId = family_id || familyId;
        const items = await prisma.knowledgeItem.findMany({
            where: { familyId: activeFamilyId, ...(child_id ? { childId: child_id } : {}) },
            orderBy: { createdAt: "desc" },
        });
        return textResult(items);
    });
    server.tool("get_knowledge_item", { item_id: z.string() }, async ({ item_id }) => {
        const item = await prisma.knowledgeItem.findUnique({ where: { id: item_id } });
        return textResult(item || { error: "knowledge item not found" });
    });
    server.tool("update_knowledge_item", {
        item_id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        kind: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ item_id, ...data }) => {
        const item = await prisma.knowledgeItem.update({ where: { id: item_id }, data });
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
                familyId: input.family_id || familyId,
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
    server.tool("list_homework", {
        family_id: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ family_id, child_id }) => {
        const activeFamilyId = family_id || familyId;
        const homework = await prisma.homework.findMany({
            where: {
                familyId: activeFamilyId,
                ...(child_id ? { childId: child_id } : {}),
            },
            orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        });
        return textResult(homework);
    });
    server.tool("update_homework_status", {
        homework_id: z.string(),
        status: z.enum(["pending", "in_progress", "done", "cancelled"]),
        completed_at: z.string().optional(),
    }, async ({ homework_id, status, completed_at }) => {
        const homework = await prisma.homework.update({
            where: { id: homework_id },
            data: {
                status,
                completedAt: status === "done" ? (completed_at ? new Date(completed_at) : new Date()) : null,
            },
        });
        return textResult(homework);
    });
    server.tool("delete_homework", { homework_id: z.string() }, async ({ homework_id }) => {
        await prisma.homework.delete({ where: { id: homework_id } });
        return textResult({ ok: true, homework_id });
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
                familyId: input.family_id || familyId,
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
    server.tool("list_textbooks", {
        family_id: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ family_id, child_id }) => {
        const activeFamilyId = family_id || familyId;
        const textbooks = await prisma.textbook.findMany({
            where: { familyId: activeFamilyId, ...(child_id ? { childId: child_id } : {}) },
            orderBy: { createdAt: "desc" },
        });
        return textResult(textbooks);
    });
    server.tool("get_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
        const textbook = await prisma.textbook.findUnique({ where: { id: textbook_id } });
        return textResult(textbook || { error: "textbook not found" });
    });
    server.tool("update_textbook", {
        textbook_id: z.string(),
        title: z.string().optional(),
        subject: z.string().optional(),
        grade: z.string().optional(),
        publisher: z.string().optional(),
        version: z.string().optional(),
        status: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ textbook_id, ...data }) => {
        const textbook = await prisma.textbook.update({ where: { id: textbook_id }, data });
        return textResult(textbook);
    });
    server.tool("delete_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
        await prisma.textbook.delete({ where: { id: textbook_id } });
        return textResult({ ok: true, textbook_id });
    });
    server.tool("create_report", {
        family_id: z.string().optional(),
        child_id: z.string(),
        type: z.enum(["weekly", "monthly"]),
        title: z.string(),
        summary: z.string().optional(),
        content: z.string().optional(),
        period_start: z.string().optional(),
        period_end: z.string().optional(),
        metrics: z.record(z.any()).optional(),
    }, async (input) => {
        const report = await prisma.report.create({
            data: {
                familyId: input.family_id || familyId,
                childId: input.child_id,
                type: input.type,
                title: input.title,
                summary: input.summary,
                content: input.content,
                periodStart: input.period_start ? new Date(input.period_start) : new Date(),
                periodEnd: input.period_end ? new Date(input.period_end) : new Date(),
                metrics: input.metrics,
            },
        });
        return textResult(report);
    });
    server.tool("list_reports", {
        family_id: z.string().optional(),
        child_id: z.string().optional(),
    }, async ({ family_id, child_id }) => {
        const activeFamilyId = family_id || familyId;
        const reports = await prisma.report.findMany({
            where: { familyId: activeFamilyId, ...(child_id ? { childId: child_id } : {}) },
            orderBy: { createdAt: "desc" },
        });
        return textResult(reports);
    });
    server.tool("update_report", {
        report_id: z.string(),
        title: z.string().optional(),
        summary: z.string().optional(),
        content: z.string().optional(),
        metrics: z.record(z.any()).optional(),
    }, async ({ report_id, ...data }) => {
        const report = await prisma.report.update({ where: { id: report_id }, data });
        return textResult(report);
    });
    server.tool("delete_report", { report_id: z.string() }, async ({ report_id }) => {
        await prisma.report.delete({ where: { id: report_id } });
        return textResult({ ok: true, report_id });
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
    function authorize(request) {
        if (!env.MCP_TOKEN)
            return true;
        const header = request.headers["x-mcp-token"] || request.headers.authorization?.replace(/^Bearer\s+/i, "");
        return header === env.MCP_TOKEN;
    }
    app.post("/mcp", async (request, reply) => {
        if (!authorize(request))
            return reply.code(401).send({ error: "invalid MCP token" });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        transport.onerror = (error) => app.log.error(error, "mcp transport error");
        const mcpServer = createEducationMcpServer(env.MCP_FAMILY_ID);
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
        if (!authorize(request))
            return reply.code(401).send({ error: "invalid MCP token" });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const mcpServer = createEducationMcpServer(env.MCP_FAMILY_ID);
        await mcpServer.connect(transport);
        await transport.handleRequest(request.raw, reply.raw);
        reply.raw.once("close", () => {
            transport.close().catch(() => { });
            mcpServer.close().catch(() => { });
        });
    });
}
