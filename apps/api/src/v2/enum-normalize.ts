/**
 * 枚举取值统一处理。
 *
 * 背景：这些字段在数据库里是枚举，但对外接口接受字符串。如果只交给数据库校验，
 * 调用方（尤其智能体）拿到的是「Expected PlanItemType」这种不含合法值的报错，
 * 只能靠猜。这里统一做三件事：
 *   1. 允许英文键、中文名称和常见写法（大小写、空格、下划线、中划线都不敏感）；
 *   2. 取值不合法时，报错直接列出全部合法值；
 *   3. 把中文别名归一成数据库枚举键，保证写入成功。
 */

export type EnumValueSpec = {
  label: string;
  aliases?: string[];
};

export type EnumSpec<T extends string> = Record<T, EnumValueSpec> & { readonly __enumName?: never };

/** 归一化比较用的键：去掉大小写、空格、下划线、中划线和全角空格。 */
function comparable(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\u3000]/g, "");
}

export function enumHint<T extends string>(spec: Record<T, EnumValueSpec>) {
  return (Object.keys(spec) as T[]).map((key) => `${key}（${spec[key].label}）`).join("、");
}

/**
 * 归一化枚举取值。无法识别时返回 null，由调用方决定是报错还是忽略。
 */
export function normalizeEnumValue<T extends string>(
  spec: Record<T, EnumValueSpec>,
  raw: unknown,
): T | null {
  const target = comparable(raw);
  if (!target) return null;
  for (const key of Object.keys(spec) as T[]) {
    if (comparable(key) === target) return key;
    const aliases = spec[key].aliases || [];
    if (aliases.some((alias) => comparable(alias) === target)) return key;
  }
  return null;
}

export class EnumValueError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/**
 * 必须合法的枚举取值。报错会带上字段名与全部合法值，便于调用方自我修正。
 */
export function requireEnumValue<T extends string>(
  spec: Record<T, EnumValueSpec>,
  raw: unknown,
  fieldLabel: string,
): T {
  const resolved = normalizeEnumValue(spec, raw);
  if (resolved) return resolved;
  throw new EnumValueError(
    `${fieldLabel}取值无效：${raw === undefined || raw === null || raw === "" ? "（空）" : `“${raw}”`}。合法值为 ${enumHint(spec)}，也可以直接写对应的中文名称。`,
  );
}

/** 可选枚举：空值返回 undefined，取值非法则报错。 */
export function optionalEnumValue<T extends string>(
  spec: Record<T, EnumValueSpec>,
  raw: unknown,
  fieldLabel: string,
): T | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  return requireEnumValue(spec, raw, fieldLabel);
}

export const PLAN_ITEM_TYPES: Record<
  "SCHOOL_HOMEWORK" | "CHILD_TASK" | "PARENT_ACTION" | "AGENT_TASK" | "RETEST",
  EnumValueSpec
> = {
  SCHOOL_HOMEWORK: { label: "学校作业", aliases: ["homework", "schoolwork", "schoolhomework", "学校作业", "校内作业", "作业", "学校任务", "课后作业"] },
  CHILD_TASK: { label: "孩子任务", aliases: ["child", "childtask", "practice", "practicetask", "exercise", "drill", "孩子任务", "学生任务", "孩子", "练习", "练习任务", "刷题"] },
  PARENT_ACTION: { label: "家长行动", aliases: ["parent", "parenttask", "parentaction", "familyaction", "家长行动", "家长任务", "家长", "家长配合", "家庭配合"] },
  AGENT_TASK: { label: "AI 任务", aliases: ["agent", "agenttask", "aitask", "aiaction", "ai", "智能体任务", "ai任务", "禾芽任务", "系统任务"] },
  RETEST: { label: "复测", aliases: ["review", "delayedreview", "recheck", "quiz", "test", "复测", "延迟复测", "复习检测", "检测", "测验"] },
};

export const PLAN_ITEM_STATUSES: Record<
  "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "CANCELLED" | "NEEDS_REVIEW",
  EnumValueSpec
> = {
  PENDING: { label: "待开始", aliases: ["todo", "notstarted", "待开始", "未开始", "待办"] },
  IN_PROGRESS: { label: "进行中", aliases: ["doing", "started", "进行中", "在做"] },
  COMPLETED: { label: "已完成", aliases: ["done", "finished", "complete", "已完成", "完成"] },
  SKIPPED: { label: "已跳过", aliases: ["skip", "已跳过", "跳过"] },
  CANCELLED: { label: "已取消", aliases: ["canceled", "已取消", "取消"] },
  NEEDS_REVIEW: { label: "需复测", aliases: ["needsreview", "需复测", "待复测", "需复习"] },
};

export const EVIDENCE_TYPES: Record<
  "OBSERVATION" | "WRITING" | "READING" | "HOMEWORK_COMPLETION" | "QUESTION_ATTEMPT" | "RETEST" | "PARENT_NOTE",
  EnumValueSpec
> = {
  OBSERVATION: { label: "行为观察", aliases: ["observe", "观察", "行为观察", "学习表现"] },
  WRITING: { label: "写作", aliases: ["write", "作文", "写作", "语文写作"] },
  READING: { label: "阅读", aliases: ["read", "阅读", "朗读", "阅读记录"] },
  HOMEWORK_COMPLETION: { label: "作业完成", aliases: ["homework", "作业", "作业完成", "作业情况"] },
  QUESTION_ATTEMPT: { label: "作答记录", aliases: ["attempt", "question", "作答", "答题", "作答记录"] },
  RETEST: { label: "复测结果", aliases: ["review", "retest", "复测", "复测结果", "检测"] },
  PARENT_NOTE: { label: "家长记录", aliases: ["parentnote", "家长记录", "家长反馈", "家长说明"] },
};

export const EVIDENCE_REVIEW_ACTIONS: Record<"confirm" | "correct", EnumValueSpec> = {
  confirm: { label: "确认", aliases: ["approved", "approve", "ok", "确认", "通过", "认可"] },
  correct: { label: "纠正", aliases: ["revise", "fix", "纠正", "修正", "修改"] },
};

export const KNOWLEDGE_NODE_TYPES: Record<
  "CHAPTER" | "KNOWLEDGE_POINT" | "CONCEPT" | "EXAMPLE" | "MISCONCEPTION",
  EnumValueSpec
> = {
  CHAPTER: { label: "章节", aliases: ["section", "unit", "章节", "单元", "课"] },
  KNOWLEDGE_POINT: { label: "知识点", aliases: ["point", "knowledgepoint", "知识点", "考点"] },
  CONCEPT: { label: "概念", aliases: ["concept", "概念", "定义"] },
  EXAMPLE: { label: "例题", aliases: ["sample", "example", "例题", "例子"] },
  MISCONCEPTION: { label: "常见错误", aliases: ["error", "mistake", "易错点", "常见错误", "错误"] },
};

export const KNOWLEDGE_RELATION_TYPES: Record<
  "PREREQUISITE_OF" | "CONTAINS" | "RELATED_TO" | "EXAMPLE_OF" | "ERROR_OF",
  EnumValueSpec
> = {
  PREREQUISITE_OF: { label: "前置依赖", aliases: ["prerequisite", "prereq", "前置", "前置依赖", "前置知识"] },
  CONTAINS: { label: "包含", aliases: ["contain", "include", "包含", "属于"] },
  RELATED_TO: { label: "相关", aliases: ["related", "relate", "相关", "关联"] },
  EXAMPLE_OF: { label: "例题属于", aliases: ["example", "实例", "例题", "例题属于"] },
  ERROR_OF: { label: "易错点属于", aliases: ["error", "mistake", "易错", "易错点属于"] },
};

export const CHILD_KNOWLEDGE_STATUSES: Record<
  "UNASSESSED" | "LEARNING" | "PARTIAL" | "MASTERED" | "NEEDS_REVIEW",
  EnumValueSpec
> = {
  UNASSESSED: { label: "未评估", aliases: ["unassessed", "未评估", "没测过"] },
  LEARNING: { label: "学习中", aliases: ["learning", "学习中", "在学"] },
  PARTIAL: { label: "部分掌握", aliases: ["partial", "部分掌握", "基本掌握"] },
  MASTERED: { label: "已掌握", aliases: ["mastered", "已掌握", "掌握"] },
  NEEDS_REVIEW: { label: "需复习", aliases: ["needsreview", "需复习", "待复测", "需要复习"] },
};

export const GOAL_STATUSES: Record<
  "DRAFT" | "PROPOSED" | "CONFIRMED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ARCHIVED",
  EnumValueSpec
> = {
  DRAFT: { label: "草稿", aliases: ["draft", "草稿"] },
  PROPOSED: { label: "待确认", aliases: ["proposed", "suggested", "待确认", "候选"] },
  CONFIRMED: { label: "已确认", aliases: ["confirmed", "已确认", "确认"] },
  ACTIVE: { label: "执行中", aliases: ["active", "执行中", "进行中"] },
  COMPLETED: { label: "已完成", aliases: ["completed", "done", "已完成", "完成"] },
  CANCELLED: { label: "已取消", aliases: ["canceled", "abandoned", "已取消", "放弃"] },
  ARCHIVED: { label: "已归档", aliases: ["archived", "已归档", "归档"] },
};
