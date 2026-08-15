import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SYNC_SPEC } from "../workbuddy-spec.js";
import {
  listEducationSkills,
  getEducationSkill,
  getCoachingPolicy,
  buildChildContext,
} from "../education-skills.js";
import {
  listChildren,
  createChild,
  updateChild,
  listRecords,
  createRecord,
  listReports,
  generateReport,
  growthSeries,
  getFamilySummary,
  listTextbooks,
  getTextbook,
  createTextbook,
  updateTextbook,
  deleteTextbook,
  createTask,
  updateTask,
  listTasks,
  createHomework,
  listHomework,
  updateHomework,
  completeHomework,
  createKnowledgeItem,
  listKnowledgeItems,
  extractTextbookChapters,
} from "../store.js";

const FAMILY_ID = process.env.FAMILY_ID || "family_001";

function textResult(payload) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

export function createMcpServer() {
  const server = new McpServer({
    name: "family-edu-mcp",
    version: "0.1.0",
  });

  server.tool("get_child_profile", { child_id: z.string() }, async ({ child_id }) => {
    const child = listChildren(FAMILY_ID).find((item) => item.id === child_id);
    if (!child) return textResult({ error: "child not found" });
    return textResult(child);
  });

  server.tool("update_child_profile", {
    child_id: z.string(),
    name: z.string().optional(),
    age: z.number().optional(),
    grade: z.string().optional(),
    subjects: z.array(z.string()).optional(),
    textbook_version: z.string().optional(),
  }, async (input) => {
    const child = updateChild(input.child_id, input);
    if (!child) return textResult({ error: "child not found" });
    return textResult(child);
  });

  server.tool("save_learning_record", "保存一条学习成长记录，必须指定 child_id 和记录类型。", {
    child_id: z.string(),
    type: z.enum(["writing", "reading", "homework", "parent_note"]),
    date: z.string().optional(),
    title: z.string(),
    score: z.number().optional(),
    notes: z.string().optional(),
  }, async (input) => {
    const record = createRecord({ family_id: FAMILY_ID, ...input });
    return textResult(record);
  });

  server.tool("get_learning_history", { child_id: z.string(), type: z.string().optional() }, async ({ child_id, type }) => {
    const records = listRecords(child_id).filter((item) => !type || item.type === type);
    return textResult(records);
  });

  server.tool("save_writing_record", {
    child_id: z.string(),
    date: z.string().optional(),
    title: z.string(),
    score: z.number().optional(),
    notes: z.string().optional(),
  }, async (input) => {
    return textResult(createRecord({ family_id: FAMILY_ID, type: "writing", ...input }));
  });

  server.tool("get_writing_history", { child_id: z.string() }, async ({ child_id }) => {
    return textResult(listRecords(child_id).filter((item) => item.type === "writing"));
  });

  server.tool("analyze_writing_progress", { child_id: z.string() }, async ({ child_id }) => {
    const records = listRecords(child_id).filter((item) => item.type === "writing");
    const avg = records.length ? Math.round(records.reduce((sum, item) => sum + item.score, 0) / records.length) : 0;
    return textResult({
      child_id,
      record_count: records.length,
      average_score: avg,
      latest_score: records.at(-1)?.score || 0,
      trend: records.length >= 2 ? records.at(-1).score - records[0].score : 0,
    });
  });

  server.tool("save_reading_record", {
    child_id: z.string(),
    date: z.string().optional(),
    title: z.string(),
    score: z.number().optional(),
    notes: z.string().optional(),
  }, async (input) => {
    return textResult(createRecord({ family_id: FAMILY_ID, type: "reading", ...input }));
  });

  server.tool("get_reading_history", { child_id: z.string() }, async ({ child_id }) => {
    return textResult(listRecords(child_id).filter((item) => item.type === "reading"));
  });

  server.tool("create_learning_task", {
    child_id: z.string(),
    subject: z.string().optional(),
    title: z.string(),
    estimated_minutes: z.number().optional(),
    priority: z.string().optional(),
    deadline: z.string().optional(),
    difficulty: z.string().optional(),
  }, async (input) => {
    return textResult(createTask({ family_id: FAMILY_ID, ...input }));
  });

  server.tool("update_learning_task", {
    task_id: z.string(),
    status: z.string().optional(),
    title: z.string().optional(),
    estimated_minutes: z.number().optional(),
    priority: z.string().optional(),
    deadline: z.string().optional(),
  }, async (input) => {
    const task = updateTask(input.task_id, input);
    if (!task) return textResult({ error: "task not found" });
    return textResult(task);
  });

  server.tool("get_daily_tasks", { child_id: z.string().optional() }, async ({ child_id }) => {
    return textResult(listTasks(child_id));
  });

  server.tool("save_homework", {
    family_id: z.string().optional(),
    child_id: z.string(),
    subject: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    estimated_minutes: z.number().optional(),
    priority: z.string().optional(),
    deadline: z.string().optional(),
    due_date: z.string().optional(),
    status: z.string().optional(),
  }, async (input) => {
    const homework = createHomework({
      family_id: input.family_id || FAMILY_ID,
      child_id: input.child_id,
      subject: input.subject || "",
      title: input.title,
      description: input.description || "",
      estimated_minutes: input.estimated_minutes || 0,
      priority: input.priority || "medium",
      deadline: input.deadline || input.due_date || "",
      due_date: input.due_date || input.deadline || "",
      status: input.status || "pending",
      source: "workbuddy_homework",
    });
    return textResult(homework);
  });

  server.tool("list_homework", {
    family_id: z.string().optional(),
    child_id: z.string().optional(),
  }, async ({ family_id, child_id }) => {
    const family = family_id || FAMILY_ID;
    const items = listHomework(child_id).filter((item) => item.family_id === family);
    return textResult(items);
  });

  server.tool("update_homework_status", {
    homework_id: z.string(),
    status: z.string().optional(),
    completed_at: z.string().optional(),
  }, async ({ homework_id, status, completed_at }) => {
    const homework = updateHomework(homework_id, { status: status || "done", completed_at: completed_at || new Date().toISOString() });
    if (!homework) return textResult({ error: "homework not found" });
    return textResult(homework);
  });

  server.tool("complete_homework", { homework_id: z.string() }, async ({ homework_id }) => {
    const homework = completeHomework(homework_id);
    if (!homework) return textResult({ error: "homework not found" });
    return textResult(homework);
  });

  server.tool("generate_weekly_report", { child_id: z.string() }, async ({ child_id }) => {
    return textResult(generateReport(child_id, "weekly"));
  });

  server.tool("generate_monthly_report", { child_id: z.string() }, async ({ child_id }) => {
    return textResult(generateReport(child_id, "monthly"));
  });

  server.tool("save_parent_note", {
    child_id: z.string(),
    title: z.string(),
    notes: z.string(),
    date: z.string().optional(),
  }, async (input) => {
    return textResult(createRecord({ family_id: FAMILY_ID, type: "parent_note", ...input }));
  });

  server.tool("get_growth_summary", { child_id: z.string() }, async ({ child_id }) => {
    return textResult({
      child_id,
      series: growthSeries(child_id),
      reports: listReports(child_id),
    });
  });

  server.tool("get_family_summary", "读取当前家庭的孩子列表和基础摘要。连接后建议优先调用，用于确认孩子和 child_id。", {}, async () => {
    return textResult(getFamilySummary(FAMILY_ID));
  });

  server.tool("list_education_skills", "读取项目内置的教育 Skill 列表，返回每个教育场景的名称、适用年龄和说明。", {}, async () => {
    return textResult(listEducationSkills());
  });

  server.tool("get_education_skill", {
    skill_id: z.string(),
  }, async ({ skill_id }) => {
    const skill = getEducationSkill(skill_id);
    if (!skill) return textResult({ error: "education skill not found" });
    return textResult(skill);
  });

  server.tool("get_child_context", {
    family_id: z.string().optional(),
    child_id: z.string(),
  }, async ({ family_id, child_id }) => {
    const context = buildChildContext(family_id || FAMILY_ID, child_id);
    if (!context) return textResult({ error: "child not found" });
    return textResult(context);
  });

  server.tool("get_coaching_policy", {
    skill_id: z.string(),
  }, async ({ skill_id }) => {
    const policy = getCoachingPolicy(skill_id);
    if (!policy) return textResult({ error: "education skill not found" });
    return textResult(policy);
  });

  server.tool("get_sync_spec", "读取禾芽家庭教务的数据同步规范。连接后或在不确定需要保存什么、使用哪个工具时，应调用此工具获取保存规则。", {}, async () => {
    return textResult(SYNC_SPEC);
  });

  server.tool("save_knowledge_item", "保存 WorkBuddy 生成的总结、报告或建议到项目知识库。", {
    family_id: z.string().optional(),
    child_id: z.string(),
    kind: z.enum(["summary", "report", "suggestion"]).optional(),
    title: z.string(),
    content: z.string(),
  }, async (input) => {
    const item = createKnowledgeItem({
      family_id: input.family_id || FAMILY_ID,
      child_id: input.child_id,
      kind: input.kind || "summary",
      title: input.title,
      content: input.content,
      source: "workbuddy",
    });
    return textResult(item);
  });

  server.tool("list_knowledge_items", { family_id: z.string().optional(), child_id: z.string().optional() }, async ({ family_id, child_id }) => {
    const family = family_id || FAMILY_ID;
    const items = listKnowledgeItems(family).filter((item) => !child_id || item.child_id === child_id);
    return textResult(items);
  });

  server.tool("import_textbook", "把家长提供的教材同步到云端教材库，并记录章节和知识点。", {
    family_id: z.string().optional(),
    child_id: z.string(),
    title: z.string(),
    subject: z.string().optional(),
    grade: z.string().optional(),
    publisher: z.string().optional(),
    version: z.string().optional(),
    file: z.string().optional(),
  }, async (input) => {
    const chapters = extractTextbookChapters(input.title, input.subject || "语文", input.grade || "");
    const textbook = createTextbook({
      family_id: FAMILY_ID,
      source: "workbuddy_upload",
      chapters,
      knowledge_points: chapters.flatMap((item) => item.knowledge_points),
      status: "ready",
      ...input,
    });
    return textResult(textbook);
  });

  server.tool("list_textbooks", {}, async () => {
    return textResult(listTextbooks(FAMILY_ID));
  });

  server.tool("get_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
    return textResult(getTextbook(textbook_id));
  });

  server.tool("update_textbook", {
    textbook_id: z.string(),
    title: z.string().optional(),
    subject: z.string().optional(),
    grade: z.string().optional(),
    publisher: z.string().optional(),
    version: z.string().optional(),
    status: z.string().optional(),
  }, async (input) => {
    const textbook = updateTextbook(input.textbook_id, input);
    if (!textbook) return textResult({ error: "textbook not found" });
    return textResult(textbook);
  });

  server.tool("delete_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
    deleteTextbook(textbook_id);
    return textResult({ ok: true, textbook_id });
  });

  return server;
}
