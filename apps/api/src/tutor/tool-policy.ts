/**
 * 工具授权表：默认拒绝。
 * 未列入的表，模型既看不到也调不到；表里每一行都是显式授权。
 *
 * 注意 pediatric 约束：孩子的对话运行时只允许只读工具 + 显式确认后的作答记录。
 * 变更类工具（删除、改教育策略、改掌握度）一律不进对话运行时。
 */

export type TutorPersona = "child_tutor" | "parent_coach";

/** 认识孩子：只读。 */
const READ_CHILD = [
  "list_children",
  "get_child_context",
  "get_child_state",
  "get_learning_priorities",
  "get_learning_history",
  "list_learning_signals",
  "get_planning_context",
];

/** 教育理念与教法：只读，人格渲染的取值来源。 */
const READ_POLICY = [
  "get_family_policy",
  "list_education_methods",
  "get_coaching_policy",
  "get_effective_skill",
  "list_education_skills",
];

/** 错题与掌握度：只读，讲题核心。 */
const READ_QUESTION = [
  "list_wrong_questions",
  "get_wrong_question",
  "get_wrong_question_practice_context",
  "list_student_mastery",
  "get_student_question_type_mastery",
  "list_question_types",
  "list_questions",
  "get_question",
  "get_question_generation_context",
];

/** 作业与教材：只读。 */
const READ_COURSEWORK = ["list_homework", "list_textbooks", "get_textbook", "list_knowledge_items", "get_knowledge_context"];

/** 学科概览：用于回答"哪一科要优先处理"。 */
const READ_OVERVIEW = ["get_subject_overview", "get_growth_summary", "get_family_summary"];

const COMMON_READ = [...READ_CHILD, ...READ_POLICY, ...READ_QUESTION, ...READ_COURSEWORK, ...READ_OVERVIEW];

const POLICY: Record<TutorPersona, Set<string>> = {
  child_tutor: new Set(COMMON_READ),
  parent_coach: new Set([
    ...COMMON_READ,
    // 家长侧才允许写：录错题、记作答、沉淀知识
    "save_wrong_question",
    "record_question_attempt",
    "save_knowledge_item",
    "save_learning_record",
    "save_reading_record",
    "save_writing_record",
    "save_homework",
  ]),
};

/** 归一化：把 persona 收敛到已知值，避免未知值意外命中空集合以外的行为。 */
export function normalizePersona(value: string | null | undefined): TutorPersona {
  return value === "parent_coach" ? "parent_coach" : "child_tutor";
}

export function allowedToolNames(persona: string | null | undefined): string[] {
  return [...POLICY[normalizePersona(persona)]].sort();
}

export function isToolAllowed(persona: string | null | undefined, toolName: string): boolean {
  return POLICY[normalizePersona(persona)].has(toolName);
}

export type ToolCallContext = {
  /** 会话钉住的孩子。为空表示家庭级会话，不注入。 */
  pinnedChildId?: string | null;
};

/**
 * 工具参数净化：服务端强制覆盖 child_id。
 * 模型即使拼出别的孩子的 id，也会在这里被换回会话钉住的值。
 *
 * acceptsChildId 来自工具自己的 schema：只对确实声明了 child_id 的工具注入，
 * 避免给不接受该参数的工具塞多余字段。
 */
export function sanitizeToolArguments(
  toolName: string,
  rawArguments: unknown,
  context: ToolCallContext,
  acceptsChildId = true,
): Record<string, unknown> {
  const args = rawArguments && typeof rawArguments === "object" ? { ...(rawArguments as Record<string, unknown>) } : {};

  delete args.family_id; // 家庭只由服务端会话决定

  if (!acceptsChildId) {
    delete args.child_id;
    return args;
  }

  if (context.pinnedChildId) {
    // 钉住了孩子：无论模型传什么、传没传，都换成钉住的那个。
    args.child_id = context.pinnedChildId;
  } else {
    // 家庭级会话（家长视角）：保留模型指定的孩子；该孩子是否属于本家庭
    // 由各工具自己的 assertChildInFamily 把关，跨家庭拿不到数据。
  }
  return args;
}

/**
 * 孩子模式下 list_children 只应返回钉住的那一个孩子。
 * 返回 null 表示不过滤。
 */
export function filterChildrenResult(persona: string | null | undefined, pinnedChildId: string | null | undefined, payload: any) {
  if (normalizePersona(persona) !== "child_tutor" || !pinnedChildId) return payload;
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.children) ? payload.children : null;
  if (!list) return payload;
  const filtered = list.filter((item: any) => item?.child_id === pinnedChildId || item?.id === pinnedChildId);
  return Array.isArray(payload) ? filtered : { ...payload, children: filtered };
}
