import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { prisma } from "./prisma.js";
import { listEducationSkills, getEducationSkill, getCoachingPolicy, buildChildContext } from "./education.js";
import { env } from "./env.js";
import { resolveFamilyByMcpToken } from "./mcp-token.js";
import {
  listFamilyPolicies,
  getEffectiveSkill,
  updateFamilyProfile,
  proposePolicyChange,
  reviewPolicyChange,
  getPolicyHistory,
  createSkillOverride,
  listSkillOverrides,
} from "./personalization.js";
import {
  createQuestion,
  createQuestionsBatch,
  createQuestionType,
  deleteQuestion,
  deleteQuestionType,
  getQuestion,
  getQuestionGenerationContext,
  getQuestionType,
  getStudentMastery,
  listQuestionAttempts,
  listQuestions,
  listQuestionTypes,
  listStudentMastery,
  recalculateMastery,
  updateMasteryOverride,
  updateQuestion,
  updateQuestionType,
} from "./question-bank.js";
import {
  createPracticePaper,
  deletePracticePaper,
  deleteRemediationPlan,
  deleteWrongQuestion,
  getPracticePaper,
  getRemediationPlan,
  getWrongQuestion,
  getWrongQuestionPracticeContext,
  listPracticePapers,
  listRemediationPlans,
  listWrongQuestions,
  recalculateWrongQuestionMastery,
  recordQuestionAttemptWithWrongBook,
  saveRemediationPlan,
  saveWrongQuestion,
  updatePracticePaper,
  updateRemediationPlan,
  updateRemediationTaskStatus,
  updateWrongQuestion,
  updateWrongQuestionStatus,
} from "./wrong-book.js";

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
  };
}

async function questionBankResult(action: () => Promise<unknown>) {
  try {
    return textResult(await action());
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : "题库操作失败" }],
    };
  }
}

export function createEducationMcpServer(familyId = env.MCP_FAMILY_ID) {
  const server = new McpServer({ name: "family-edu-mcp", version: "2.0.0" });
  const ensureOwned = async (modelName: string, id: string, label: string) => {
    const model = (prisma as any)[modelName];
    const item = await model.findFirst({ where: { id, familyId }, select: { id: true } });
    if (!item) throw new Error(`${label}不存在或不属于当前家庭`);
  };
  const ensureChild = (childId: string) => ensureOwned("child", childId, "学生");

  server.tool("list_education_skills", "读取项目内置的教育 Skill 列表。", {}, async () => textResult(listEducationSkills()));

  server.tool("get_education_skill", { skill_id: z.string() }, async ({ skill_id }) => {
    const skill = getEducationSkill(skill_id);
    return skill ? textResult(skill) : textResult({ error: "education skill not found" });
  });

  server.tool("get_coaching_policy", { skill_id: z.string() }, async ({ skill_id }) => {
    const policy = getCoachingPolicy(skill_id);
    return policy ? textResult(policy) : textResult({ error: "education skill not found" });
  });

  server.tool("get_sync_spec", "读取禾芽最新版 WorkBuddy 数据同步、题库与错题教学工作规范。首次连接、工具变化或不确定应保存什么时调用。", {}, async () => textResult({
    version: "2.2",
    family_identity: "家庭身份只由 X-MCP-Token 决定，不传入或猜测 family_id。",
    child_rule: "涉及具体学生时先调用 list_children 确认 child_id，再读取 get_child_context。",
    save_rule: "普通闲聊不保存；家长明确要求保存、同步、写入、记录时调用对应工具。",
    workflows: {
      writing: ["get_child_context", "get_education_skill(writing-coach)", "save_writing_record"],
      reading: ["get_child_context", "get_education_skill(reading-coach)", "save_reading_record"],
      homework: ["save_homework", "update_homework_status", "complete_homework"],
      knowledge: ["save_knowledge_item", "list_knowledge_items"],
      textbook: ["import_textbook", "list_textbooks", "update_textbook"],
      question_bank: ["list_question_types", "create_question_type", "save_question or save_questions_batch"],
      practice: ["get_question_generation_context", "save_questions_batch", "record_question_attempt", "get_student_question_type_mastery"],
      wrong_book_capture: ["list_children", "list_question_types", "save_question when needed", "record_question_attempt(save_to_wrong_book=true) or save_wrong_question"],
      wrong_book_practice: ["get_wrong_question", "get_wrong_question_practice_context", "save_questions_batch", "create_practice_paper", "record_question_attempt"],
      remediation: ["get_wrong_question", "get_wrong_question_practice_context", "save_remediation_plan", "update_remediation_task_status"],
    },
    wrong_book_rule: "识别到真实错题时记录错误答案、原因和分析；同一学生同一题重复出错应累计，不创建重复条目。",
    mastery_rule: "单次答对不能判定已掌握；错题默认需完成原题订正、至少3道独立正确变式、至少2次会话、迁移题及24小时后复测，且掌握分达到80。后续再错必须转为需复习。",
    generation_rule: "生成同类题、针对性试卷或教学规划前，必须先读取错题练习上下文；不得只替换数字或人名。生成结果保存后才能用于追踪作答。",
  }));

  server.tool("list_family_policies", { family_id: z.string().optional() }, async ({ family_id }) => {
    return textResult(await listFamilyPolicies(familyId));
  });

  server.tool("get_effective_skill", {
    family_id: z.string().optional(),
    skill_id: z.string(),
  }, async ({ family_id, skill_id }) => {
    const effective = await getEffectiveSkill(familyId, skill_id);
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
    const profile = await updateFamilyProfile(familyId, input.skill_id, {
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
    const change = await proposePolicyChange(familyId, input.skill_id, {
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
    await ensureOwned("policyChange", change_id, "教育方式建议");
    return textResult(await reviewPolicyChange(change_id, action, "parent"));
  });

  server.tool("get_policy_history", {
    family_id: z.string().optional(),
    skill_id: z.string().optional(),
  }, async ({ family_id, skill_id }) => {
    return textResult(await getPolicyHistory(familyId, skill_id));
  });

  server.tool("create_skill_override", {
    family_id: z.string().optional(),
    skill_id: z.string(),
    path: z.string(),
    original_value: z.string().optional(),
    custom_value: z.string(),
    reason: z.string().optional(),
  }, async (input) => {
    return textResult(await createSkillOverride(familyId, input.skill_id, {
      path: input.path,
      original_value: input.original_value,
      custom_value: input.custom_value,
      reason: input.reason,
    }));
  });

  server.tool("list_skill_overrides", {
    family_id: z.string().optional(),
    skill_id: z.string(),
  }, async ({ family_id, skill_id }) => {
    return textResult(await listSkillOverrides(familyId, skill_id));
  });

  server.tool("list_children", { family_id: z.string().optional() }, async ({ family_id }) => {
    const children = await prisma.child.findMany({
      where: { familyId, status: "active" },
      orderBy: { createdAt: "asc" },
    });
    return textResult(children);
  });

  server.tool("get_family_summary", { family_id: z.string().optional() }, async ({ family_id }) => {
    const activeFamilyId = familyId;
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
        familyId,
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
    await ensureChild(input.child_id);
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
    await ensureChild(child_id);
    await prisma.child.delete({ where: { id: child_id } });
    return textResult({ ok: true, child_id });
  });

  server.tool("get_child_context", { family_id: z.string().optional(), child_id: z.string() }, async ({ family_id, child_id }) => {
    const activeFamilyId = familyId;
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
    await ensureChild(input.child_id);
    const record = await prisma.record.create({
      data: {
        familyId,
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
    await ensureChild(input.child_id);
    const record = await prisma.record.create({
      data: {
        familyId,
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
    await ensureChild(input.child_id);
    const record = await prisma.record.create({
      data: {
        familyId,
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
    await ensureChild(child_id);
    const records = await prisma.record.findMany({
      where: { familyId, childId: child_id, ...(type ? { type } : {}) },
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
    await ensureOwned("record", record_id, "成长记录");
    const record = await prisma.record.update({ where: { id: record_id }, data });
    return textResult(record);
  });

  server.tool("delete_record", { record_id: z.string() }, async ({ record_id }) => {
    await ensureOwned("record", record_id, "成长记录");
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
    await ensureChild(input.child_id);
    const item = await prisma.knowledgeItem.create({
      data: {
        familyId,
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
    await ensureOwned("knowledgeItem", item_id, "知识库内容");
    await prisma.knowledgeItem.delete({ where: { id: item_id } });
    return textResult({ ok: true, item_id });
  });

  server.tool("list_knowledge_items", {
    family_id: z.string().optional(),
    child_id: z.string().optional(),
  }, async ({ family_id, child_id }) => {
    const activeFamilyId = familyId;
    if (child_id) await ensureChild(child_id);
    const items = await prisma.knowledgeItem.findMany({
      where: { familyId: activeFamilyId, ...(child_id ? { childId: child_id } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return textResult(items);
  });

  server.tool("get_knowledge_item", { item_id: z.string() }, async ({ item_id }) => {
    const item = await prisma.knowledgeItem.findFirst({ where: { id: item_id, familyId } });
    return textResult(item || { error: "knowledge item not found" });
  });

  server.tool("update_knowledge_item", {
    item_id: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    kind: z.string().optional(),
    child_id: z.string().optional(),
  }, async ({ item_id, child_id, ...data }) => {
    await ensureOwned("knowledgeItem", item_id, "知识库内容");
    if (child_id) await ensureChild(child_id);
    const item = await prisma.knowledgeItem.update({ where: { id: item_id }, data: { ...data, childId: child_id } });
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
    await ensureChild(input.child_id);
    const homework = await prisma.homework.create({
      data: {
        familyId,
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
    await ensureOwned("homework", homework_id, "作业");
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
    const activeFamilyId = familyId;
    if (child_id) await ensureChild(child_id);
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
    await ensureOwned("homework", homework_id, "作业");
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
    await ensureOwned("homework", homework_id, "作业");
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
    await ensureChild(input.child_id);
    const textbook = await prisma.textbook.create({
      data: {
        familyId,
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
    const activeFamilyId = familyId;
    if (child_id) await ensureChild(child_id);
    const textbooks = await prisma.textbook.findMany({
      where: { familyId: activeFamilyId, ...(child_id ? { childId: child_id } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return textResult(textbooks);
  });

  server.tool("get_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
    const textbook = await prisma.textbook.findFirst({ where: { id: textbook_id, familyId } });
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
  }, async ({ textbook_id, child_id, ...data }) => {
    await ensureOwned("textbook", textbook_id, "教材");
    if (child_id) await ensureChild(child_id);
    const textbook = await prisma.textbook.update({ where: { id: textbook_id }, data: { ...data, childId: child_id } });
    return textResult(textbook);
  });

  server.tool("delete_textbook", { textbook_id: z.string() }, async ({ textbook_id }) => {
    await ensureOwned("textbook", textbook_id, "教材");
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
    await ensureChild(input.child_id);
    const report = await prisma.report.create({
      data: {
        familyId,
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
    const activeFamilyId = familyId;
    if (child_id) await ensureChild(child_id);
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
    await ensureOwned("report", report_id, "报告");
    const report = await prisma.report.update({ where: { id: report_id }, data });
    return textResult(report);
  });

  server.tool("delete_report", { report_id: z.string() }, async ({ report_id }) => {
    await ensureOwned("report", report_id, "报告");
    await prisma.report.delete({ where: { id: report_id } });
    return textResult({ ok: true, report_id });
  });

  server.tool("get_growth_summary", { child_id: z.string() }, async ({ child_id }) => {
    await ensureChild(child_id);
    const [records, reports] = await Promise.all([
      prisma.record.findMany({ where: { familyId, childId: child_id }, orderBy: { date: "asc" } }),
      prisma.report.findMany({ where: { familyId, childId: child_id }, orderBy: { createdAt: "desc" } }),
    ]);
    return textResult({ child_id, record_count: records.length, records, reports });
  });

  const questionTypeFields = {
    subject: z.string().min(1).describe("可扩展学科，例如数学、语文、英语、科学、地理、物理、化学或其他"),
    grade: z.string().optional(),
    name: z.string().min(1).describe("可复用的题型名称"),
    description: z.string().optional(),
    textbook: z.string().optional(),
    chapter: z.string().optional(),
    knowledge_points: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    ability_goal: z.string().optional(),
    solution_method: z.string().optional(),
    standard_steps: z.any().optional(),
    common_errors: z.any().optional(),
    invariants: z.any().optional(),
    variable_parameters: z.any().optional(),
    difficulty_levels: z.any().optional(),
    generation_rule: z.any().optional(),
    answer_validation: z.any().optional(),
    mastery_criteria: z.any().optional(),
    rule_version: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  };
  const questionFields = {
    question_type_id: z.string().min(1),
    stem: z.string().min(1),
    format: z.enum(["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "essay", "calculation"]).optional(),
    options: z.any().optional(),
    answer: z.any().optional(),
    solution: z.string().optional(),
    scoring_rubric: z.any().optional(),
    difficulty: z.enum(["basic", "advanced", "transfer", "review"]).optional(),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
    original_content: z.string().optional(),
    file_key: z.string().optional(),
    source_question_id: z.string().optional(),
    generation_rule_version: z.string().optional(),
    variation_type: z.string().optional(),
    generated_by_workbuddy: z.boolean().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  };

  server.tool("create_question_type", "创建家庭题型分类及其解题、生成和掌握判定规则。找不到合适题型且家长确认后使用。", questionTypeFields, async (input) => (
    questionBankResult(() => createQuestionType(familyId, input))
  ));

  server.tool("list_question_types", "分页查询当前家庭的题型分类。录入题目和生成变式题前先调用，避免重复创建题型。", {
    subject: z.string().optional(),
    grade: z.string().optional(),
    knowledge_point: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (input) => questionBankResult(() => listQuestionTypes(familyId, input)));

  server.tool("get_question_type", "读取一个题型的完整定义、生成规则、题目和学生掌握情况。", {
    question_type_id: z.string(),
  }, async ({ question_type_id }) => questionBankResult(() => getQuestionType(familyId, question_type_id)));

  server.tool("update_question_type", "更新当前家庭的题型定义或规则。规则变化时应同步更新 rule_version。", {
    question_type_id: z.string(),
    ...Object.fromEntries(Object.entries(questionTypeFields).map(([key, schema]) => [key, schema.optional()])),
  } as any, async ({ question_type_id, ...input }: any) => questionBankResult(() => updateQuestionType(familyId, question_type_id, input)));

  server.tool("delete_question_type", "删除没有关联题目的题型。已有题目时会拒绝删除，应改用 update_question_type 停用。", {
    question_type_id: z.string(),
  }, async ({ question_type_id }) => questionBankResult(() => deleteQuestionType(familyId, question_type_id)));

  server.tool("save_question", "向当前家庭题库保存一道题，必须归入已有题型，并附答案、解析和难度。", questionFields, async (input) => (
    questionBankResult(() => createQuestion(familyId, input))
  ));

  server.tool("save_questions_batch", "批量保存最多 50 道同题型或多题型题目。生成变式练习后使用。", {
    questions: z.array(z.object(questionFields)).min(1).max(50),
  }, async ({ questions }) => questionBankResult(() => createQuestionsBatch(familyId, questions)));

  server.tool("list_questions", "分页查询当前家庭题库，可按学科、学生掌握情况、题型、难度和来源筛选。", {
    child_id: z.string().optional(),
    subject: z.string().optional(),
    grade: z.string().optional(),
    chapter: z.string().optional(),
    knowledge_point: z.string().optional(),
    question_type_id: z.string().optional(),
    difficulty: z.enum(["basic", "advanced", "transfer", "review"]).optional(),
    source: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (input) => questionBankResult(() => listQuestions(familyId, input)));

  server.tool("get_question", "读取题目详情、题型规则和最近学生作答记录。", {
    question_id: z.string(),
  }, async ({ question_id }) => questionBankResult(() => getQuestion(familyId, question_id)));

  server.tool("update_question", "更新当前家庭的一道题。已有作答记录时不能改变题型。", {
    question_id: z.string(),
    ...Object.fromEntries(Object.entries(questionFields).map(([key, schema]) => [key, schema.optional()])),
  } as any, async ({ question_id, ...input }: any) => questionBankResult(() => updateQuestion(familyId, question_id, input)));

  server.tool("delete_question", "删除没有学生作答记录的题目。已有作答证据时会拒绝删除，应改为停用。", {
    question_id: z.string(),
  }, async ({ question_id }) => questionBankResult(() => deleteQuestion(familyId, question_id)));

  server.tool("get_question_generation_context", "生成同题型练习前必须调用。返回题型不变量、可变参数、难度规则、学生薄弱点、掌握度和标准输出结构。", {
    question_type_id: z.string(),
    child_id: z.string().optional(),
    source_question_id: z.string().optional(),
    target_difficulty: z.enum(["basic", "advanced", "transfer", "review"]).optional(),
    count: z.number().int().min(1).max(20).optional(),
  }, async (input) => questionBankResult(() => getQuestionGenerationContext(familyId, input)));

  server.tool("record_question_attempt", "保存学生一次真实作答，关联错题或试卷，并自动重算题型及错题掌握度。", {
    child_id: z.string(),
    question_id: z.string(),
    question_type_id: z.string().optional(),
    student_answer: z.any().optional(),
    is_correct: z.boolean().optional(),
    score: z.number().min(0).max(100).optional(),
    duration_seconds: z.number().int().min(0).optional(),
    used_hint: z.boolean().optional(),
    hint_count: z.number().int().min(0).optional(),
    error_reason: z.string().optional(),
    error_category: z.string().optional(),
    evaluation: z.string().optional(),
    wrong_question_id: z.string().optional(),
    practice_paper_id: z.string().optional(),
    is_original_correction: z.boolean().optional(),
    is_independent: z.boolean().optional(),
    variation_type: z.string().optional(),
    session_id: z.string().optional(),
    save_to_wrong_book: z.boolean().optional().describe("本次答错且用户明确要求保存时设为 true"),
    attempted_at: z.string().datetime().optional(),
  }, async (input) => questionBankResult(() => recordQuestionAttemptWithWrongBook(familyId, input)));

  server.tool("list_question_attempts", "分页查询当前家庭的学生作答证据。", {
    child_id: z.string().optional(),
    question_id: z.string().optional(),
    question_type_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (input) => questionBankResult(() => listQuestionAttempts(familyId, input)));

  server.tool("get_student_question_type_mastery", "读取一名学生对一个题型的掌握分、状态、证据和复习时间。", {
    child_id: z.string(),
    question_type_id: z.string(),
  }, async ({ child_id, question_type_id }) => questionBankResult(() => getStudentMastery(familyId, child_id, question_type_id)));

  server.tool("list_student_mastery", "分页查询学生题型掌握情况，可筛选学生、学科和状态。", {
    child_id: z.string().optional(),
    question_type_id: z.string().optional(),
    subject: z.string().optional(),
    status: z.enum(["unassessed", "learning", "basic", "mastered", "needs_review"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }, async (input) => questionBankResult(() => listStudentMastery(familyId, input)));

  server.tool("update_student_question_type_mastery", "人工修正学生题型掌握状态，必须说明原因；也可清除人工修正恢复自动计算。", {
    child_id: z.string(),
    question_type_id: z.string(),
    status: z.enum(["unassessed", "learning", "basic", "mastered", "needs_review"]).optional(),
    reason: z.string().optional(),
    source: z.enum(["parent", "workbuddy"]).optional(),
    clear_manual_override: z.boolean().optional(),
  }, async ({ child_id, question_type_id, ...input }) => questionBankResult(() => updateMasteryOverride(familyId, child_id, question_type_id, input)));

  server.tool("recalculate_student_mastery", "根据全部作答证据重新计算学生对一个题型的掌握度，人工修正仍会保留。", {
    child_id: z.string(),
    question_type_id: z.string(),
  }, async ({ child_id, question_type_id }) => questionBankResult(() => recalculateMastery(familyId, child_id, question_type_id)));

  const paginationFields = {
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  };
  const paperQuestionFields = z.object({
    question_id: z.string(),
    wrong_question_id: z.string().optional(),
    allow_variant: z.boolean().optional(),
    section: z.string().optional(),
    sequence: z.number().int().min(1).optional(),
    score: z.number().min(0).optional(),
    purpose: z.string().optional(),
    target_error_category: z.string().optional(),
  });
  const remediationTaskFields = z.object({
    wrong_question_id: z.string().optional(),
    question_type_id: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    task_type: z.string().min(1),
    sequence: z.number().int().min(1).optional(),
    estimated_minutes: z.number().int().min(0).optional(),
    due_at: z.string().datetime().optional(),
    status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
    completion_evidence: z.any().optional(),
    completed_at: z.string().datetime().optional(),
  });

  server.tool("save_wrong_question", "将已存在的题目保存到某个学生的错题本。同一学生同一题重复出错会累计次数。", {
    child_id: z.string(), question_id: z.string(), question_type_id: z.string().optional(), source_attempt_id: z.string().optional(),
    wrong_answer: z.any().optional(), error_reason: z.string().optional(), error_category: z.string().optional(), workbuddy_analysis: z.string().optional(),
    correction_method: z.string().optional(), key_learning_point: z.string().optional(), wrong_at: z.string().datetime().optional(), source: z.string().optional(),
  }, async (input) => questionBankResult(() => saveWrongQuestion(familyId, input)));

  server.tool("list_wrong_questions", "分页查询当前家庭错题，可按学生、学科、题型、知识点、错误类型和状态筛选。", {
    child_id: z.string().optional(), subject: z.string().optional(), grade: z.string().optional(), question_type_id: z.string().optional(),
    knowledge_point: z.string().optional(), error_category: z.string().optional(), status: z.enum(["pending_correction", "strengthening", "mastered", "needs_review", "archived"]).optional(),
    query: z.string().optional(), ...paginationFields,
  }, async (input) => questionBankResult(() => listWrongQuestions(familyId, input)));

  server.tool("get_wrong_question", "读取错题原题、解析、错误原因、掌握证据、练习记录、关联试卷和教学任务。", { wrong_question_id: z.string() }, async ({ wrong_question_id }) => (
    questionBankResult(() => getWrongQuestion(familyId, wrong_question_id))
  ));

  server.tool("update_wrong_question", "修正错题的章节、知识点、错误分析、订正方法和复习时间，不用于伪造掌握证据。", {
    wrong_question_id: z.string(), grade: z.string().optional(), textbook: z.string().optional(), chapter: z.string().optional(), knowledge_points: z.array(z.string()).optional(),
    error_reason: z.string().optional(), error_category: z.string().optional(), workbuddy_analysis: z.string().optional(), correction_method: z.string().optional(),
    key_learning_point: z.string().optional(), next_review_at: z.string().datetime().optional(),
  }, async ({ wrong_question_id, ...input }) => questionBankResult(() => updateWrongQuestion(familyId, wrong_question_id, input)));

  server.tool("delete_wrong_question", "删除无关联证据的错题；有关联练习、试卷或任务时按数据完整性规则归档。", { wrong_question_id: z.string() }, async ({ wrong_question_id }) => (
    questionBankResult(() => deleteWrongQuestion(familyId, wrong_question_id))
  ));

  server.tool("update_wrong_question_status", "人工修正错题状态时必须填写原因，也可清除人工修正恢复自动判定。", {
    wrong_question_id: z.string(), status: z.enum(["pending_correction", "strengthening", "mastered", "needs_review", "archived"]).optional(),
    reason: z.string().optional(), source: z.enum(["parent", "workbuddy"]).optional(), clear_manual_override: z.boolean().optional(),
  }, async ({ wrong_question_id, ...input }) => questionBankResult(() => updateWrongQuestionStatus(familyId, wrong_question_id, input)));

  server.tool("recalculate_wrong_question_mastery", "根据全部关联作答重新计算错题掌握度，同时重算对应题型掌握度。", { wrong_question_id: z.string() }, async ({ wrong_question_id }) => (
    questionBankResult(() => recalculateWrongQuestionMastery(familyId, wrong_question_id))
  ));

  server.tool("get_wrong_question_practice_context", "生成错题变式题、针对性试卷或教学规划前必须调用，返回规则、薄弱点、未覆盖变式和标准输出。", {
    wrong_question_id: z.string(), target_difficulty: z.enum(["basic", "advanced", "transfer", "review"]).optional(), count: z.number().int().min(1).max(20).optional(),
  }, async (input) => questionBankResult(() => getWrongQuestionPracticeContext(familyId, input)));

  server.tool("create_practice_paper", "保存 WorkBuddy 已生成的针对性练习试卷。题目必须先保存到当前家庭题库。", {
    child_id: z.string(), title: z.string().min(1), subject: z.string().optional(), grade: z.string().optional(), objective: z.string().optional(),
    diagnosis_summary: z.string().optional(), difficulty_distribution: z.any().optional(), estimated_minutes: z.number().int().min(0).optional(),
    total_score: z.number().min(0).optional(), status: z.enum(["draft", "ready", "in_progress", "completed", "archived"]).optional(), questions: z.array(paperQuestionFields).min(1).max(100),
  }, async (input) => questionBankResult(() => createPracticePaper(familyId, input)));

  server.tool("list_practice_papers", "分页查询针对性练习试卷。", {
    child_id: z.string().optional(), subject: z.string().optional(), status: z.enum(["draft", "ready", "in_progress", "completed", "archived"]).optional(), query: z.string().optional(), ...paginationFields,
  }, async (input) => questionBankResult(() => listPracticePapers(familyId, input)));

  server.tool("get_practice_paper", "读取试卷题目、答案解析、关联错题和学生作答。", { practice_paper_id: z.string() }, async ({ practice_paper_id }) => (
    questionBankResult(() => getPracticePaper(familyId, practice_paper_id))
  ));

  server.tool("update_practice_paper", "更新试卷元数据、状态、结果总结，或整体替换题目清单。", {
    practice_paper_id: z.string(), title: z.string().optional(), subject: z.string().optional(), grade: z.string().optional(), objective: z.string().optional(),
    diagnosis_summary: z.string().optional(), difficulty_distribution: z.any().optional(), estimated_minutes: z.number().int().min(0).optional(), total_score: z.number().min(0).optional(),
    status: z.enum(["draft", "ready", "in_progress", "completed", "archived"]).optional(), completed_at: z.string().datetime().optional(), result_summary: z.any().optional(),
    questions: z.array(paperQuestionFields).min(1).max(100).optional(),
  }, async ({ practice_paper_id, ...input }) => questionBankResult(() => updatePracticePaper(familyId, practice_paper_id, input)));

  server.tool("delete_practice_paper", "删除未作答试卷；已有作答记录时归档。不会删除题库题目。", { practice_paper_id: z.string() }, async ({ practice_paper_id }) => (
    questionBankResult(() => deletePracticePaper(familyId, practice_paper_id))
  ));

  server.tool("save_remediation_plan", "保存 WorkBuddy 根据错题证据生成的教学规划和任务。", {
    child_id: z.string(), title: z.string().min(1), subject: z.string().optional(), diagnosis: z.any().optional(), objectives: z.any().optional(), strategy: z.string().optional(),
    start_date: z.string().datetime().optional(), end_date: z.string().datetime().optional(), status: z.enum(["draft", "active", "completed", "archived"]).optional(),
    tasks: z.array(remediationTaskFields).min(1).max(100),
  }, async (input) => questionBankResult(() => saveRemediationPlan(familyId, input)));

  server.tool("list_remediation_plans", "分页查询学生错题教学规划。", {
    child_id: z.string().optional(), subject: z.string().optional(), status: z.enum(["draft", "active", "completed", "archived"]).optional(), query: z.string().optional(), ...paginationFields,
  }, async (input) => questionBankResult(() => listRemediationPlans(familyId, input)));

  server.tool("get_remediation_plan", "读取教学规划诊断、目标、策略、任务和完成证据。", { remediation_plan_id: z.string() }, async ({ remediation_plan_id }) => (
    questionBankResult(() => getRemediationPlan(familyId, remediation_plan_id))
  ));

  server.tool("update_remediation_plan", "更新教学规划或整体替换任务清单。", {
    remediation_plan_id: z.string(), title: z.string().optional(), subject: z.string().optional(), diagnosis: z.any().optional(), objectives: z.any().optional(), strategy: z.string().optional(),
    start_date: z.string().datetime().optional(), end_date: z.string().datetime().optional(), status: z.enum(["draft", "active", "completed", "archived"]).optional(),
    tasks: z.array(remediationTaskFields).min(1).max(100).optional(),
  }, async ({ remediation_plan_id, ...input }) => questionBankResult(() => updateRemediationPlan(familyId, remediation_plan_id, input)));

  server.tool("update_remediation_task_status", "更新一个教学任务的执行状态和完成证据。", {
    remediation_plan_id: z.string(), task_id: z.string(), status: z.enum(["pending", "in_progress", "completed", "skipped"]),
    completion_evidence: z.any().optional(), completed_at: z.string().datetime().optional(),
  }, async ({ remediation_plan_id, task_id, ...input }) => questionBankResult(() => updateRemediationTaskStatus(familyId, remediation_plan_id, task_id, input)));

  server.tool("delete_remediation_plan", "删除尚无完成任务的教学规划；已有完成证据时归档。", { remediation_plan_id: z.string() }, async ({ remediation_plan_id }) => (
    questionBankResult(() => deleteRemediationPlan(familyId, remediation_plan_id))
  ));

  return server;
}

export async function registerMcpHttp(app: FastifyInstance) {
  function getFamilyFromRequest(request: any) {
    const header = request.headers["x-mcp-token"] || request.headers.authorization?.replace(/^Bearer\s+/i, "");
    return resolveFamilyByMcpToken(header);
  }

  app.post("/mcp", async (request, reply) => {
    const familyId = await getFamilyFromRequest(request);
    if (!familyId) return reply.code(401).send({ error: "invalid MCP token" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    transport.onerror = (error) => app.log.error(error, "mcp transport error");
    const mcpServer = createEducationMcpServer(familyId);
    await mcpServer.connect(transport);
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      app.log.error(error, "mcp request error");
      if (!reply.sent) reply.code(500).send({ error: "MCP request failed" });
    } finally {
      reply.raw.once("close", () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });
    }
  });

  app.get("/mcp", async (request, reply) => {
    const familyId = await getFamilyFromRequest(request);
    if (!familyId) return reply.code(401).send({ error: "invalid MCP token" });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createEducationMcpServer(familyId);
    await mcpServer.connect(transport);
    await transport.handleRequest(request.raw, reply.raw);
    reply.raw.once("close", () => {
      transport.close().catch(() => {});
      mcpServer.close().catch(() => {});
    });
  });
}
