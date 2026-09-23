/**
 * 展示层映射，口径与小程序保持一致（miniprogram/utils/presentation.js）。
 * 规则计算结果全部来自服务端，这里只负责把结果翻译成文案和素材地址，
 * 避免电脑端和小程序各算一套，家长在两端看到不同结论。
 */

const asset = (name: string) => `${import.meta.env.BASE_URL}brand/${name}`;

export const SCENES = [asset("scene-home.webp"), asset("scene-school.webp"), asset("scene-outdoor.webp")];

const STATE_FILES: Record<string, Record<string, string>> = {
  male: {
    stable: "child-stable.png",
    progress: "child-progress.png",
    thinking: "child-thinking.png",
    review: "child-review.png",
    done: "child-done.png",
  },
  female: {
    stable: "child-stable-female.png",
    progress: "child-progress-female.png",
    thinking: "child-thinking-female.png",
    review: "child-review-female.png",
    done: "child-done-female.png",
  },
};

/** 已上线的女生素材状态，未登记的状态回退到男生形象，避免出现空白。 */
export const FEMALE_READY_STATES = ["stable", "progress", "thinking", "review", "done"];

export function normalizedGender(value: unknown): "male" | "female" {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

export function hasFemaleAsset(state: string) {
  return FEMALE_READY_STATES.includes(state);
}

export function stateAsset(state: string, gender?: unknown) {
  const wanted = normalizedGender(gender);
  const files = STATE_FILES[wanted];
  const name = (wanted === "female" && !hasFemaleAsset(state) ? STATE_FILES.male[state] : files[state]) || files.stable;
  return asset(name);
}

function stableHash(value: unknown) {
  let result = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    result = ((result << 5) - result + text.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

export function dateKey(value?: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 每天换一次场景，同一天里同一个孩子保持稳定。 */
export function dailyScene(childId?: string, value?: Date) {
  return SCENES[stableHash(`${dateKey(value)}:${childId || "family"}`) % SCENES.length];
}

export function formatDate(value?: string | number | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

const STATUS_LABELS: Record<string, string> = {
  unassessed: "待评估",
  learning: "学习中",
  basic: "基本掌握",
  mastered: "已掌握",
  needs_review: "待复测",
};

function statusLabel(status?: string) {
  return STATUS_LABELS[String(status || "")] || "观察中";
}

function textFromWrong(item: any) {
  if (!item) return "";
  if (item.questionType && item.questionType.name) return item.questionType.name;
  if (Array.isArray(item.knowledgePoints) && item.knowledgePoints[0]) return item.knowledgePoints[0];
  return item.subject || "错题";
}

export type ChildPresentation = {
  state: string;
  image: string;
  title: string;
  subtitle: string;
  tags: string[];
  evidence: string;
  judgment: string;
  action: string;
  weakness: { name: string; score: number | null; count: number } | null;
  activeGoal: any;
  relationship: any;
  pendingHomework: number;
  hasEvidence: boolean;
};

/**
 * 孩子状态结论：整体状态 → 原因 → 下一步。
 * 与小程序 child-state 页共用同一套推导，保证两端讲的是同一件事。
 */
export function deriveChildPresentation(input: {
  child?: any;
  childState?: any;
  relationship?: any;
  wrongQuestions?: any;
  mastery?: any;
  reports?: any[];
  homework?: any[];
}): ChildPresentation {
  const child = input.child || null;
  const childState = input.childState || null;
  const relationship = input.relationship || null;
  const wrongItems = (input.wrongQuestions && input.wrongQuestions.items) || [];
  const masteryItems = (input.mastery && input.mastery.items) || [];
  const reports = input.reports || [];
  const homework = input.homework || [];
  const summary = (childState && childState.summary) || {};
  const activeGoal = childState && childState.active_goal;
  const openWrong = wrongItems.filter((item: any) => !["mastered", "archived"].includes(item.status));
  const weakest = masteryItems
    .filter((item: any) => item && item.questionType)
    .slice()
    .sort((a: any, b: any) => Number(a.masteryScore || 0) - Number(b.masteryScore || 0))[0];
  const pendingHomework = homework.filter((item: any) => !["done", "cancelled"].includes(item.status));
  const evidenceCount = Number(summary.evidence_7d || 0);
  const hasEvidence = evidenceCount > 0 || wrongItems.length > 0 || masteryItems.length > 0 || reports.length > 0;

  if (!child) {
    return {
      state: "stable",
      image: stateAsset("stable", null),
      title: "先建立孩子档案",
      subtitle: "有了档案，学习记录才能准确归到同一个孩子名下",
      tags: ["等待建档"],
      evidence: "当前没有可分析的学生数据",
      judgment: "尚不能判断孩子的学习状态",
      action: "先添加学生，再让 WorkBuddy 同步真实学习记录",
      weakness: null,
      activeGoal: null,
      relationship: null,
      pendingHomework: 0,
      hasEvidence: false,
    };
  }

  let state = "stable";
  if (openWrong.some((item: any) => item.status === "needs_review")) state = "review";
  else if (openWrong.length || (weakest && Number(weakest.masteryScore || 0) < 60)) state = "thinking";
  else if (weakest && Number(weakest.masteryScore || 0) >= 80) state = "progress";
  else if (pendingHomework.length === 0 && hasEvidence) state = "done";

  const weaknessName = openWrong.length
    ? textFromWrong(openWrong[0])
    : weakest && weakest.questionType
      ? weakest.questionType.name
      : "";
  const masteryScore =
    weakest && Number.isFinite(Number(weakest.masteryScore)) ? Math.round(Number(weakest.masteryScore)) : null;
  const tags: string[] = [];
  if (openWrong.length) tags.push(`${openWrong.length} 个错题点`);
  if (weakest) tags.push(`${statusLabel(weakest.status)}${masteryScore === null ? "" : ` ${masteryScore}分`}`);
  if (relationship && relationship.status) tags.push(`亲子关系 ${relationship.status}`);
  if (!tags.length) tags.push(hasEvidence ? "状态稳定" : "等待更多记录");

  return {
    state,
    image: stateAsset(state, child.gender),
    title: hasEvidence
      ? `${child.name}，${
          state === "progress"
            ? "正在进步"
            : state === "review"
              ? "该复测了"
              : state === "thinking"
                ? "正在巩固"
                : state === "done"
                  ? "本轮已完成"
                  : "状态平稳"
        }`
      : `${child.name}，等待更多学习记录`,
    subtitle: weaknessName ? `当前最值得关注：${weaknessName}` : "当前没有足够证据确认具体薄弱点",
    tags: tags.slice(0, 3),
    evidence: `近 7 天 ${evidenceCount} 条证据 · ${openWrong.length} 个待处理错题 · ${pendingHomework.length} 项未完成`,
    judgment: weaknessName
      ? `${weaknessName}${masteryScore === null ? "仍需结合后续练习确认" : `当前掌握度 ${masteryScore} 分`}`
      : "现有数据不足以给出具体薄弱判断",
    action:
      activeGoal && (activeGoal.objective || activeGoal.title)
        ? activeGoal.objective || activeGoal.title
        : weaknessName
          ? `让 WorkBuddy 围绕“${weaknessName}”安排一次订正和变式复测`
          : "继续同步真实作业、错题和阅读记录，形成可验证的学习证据",
    weakness: weaknessName ? { name: weaknessName, score: masteryScore, count: openWrong.length } : null,
    activeGoal: activeGoal || null,
    relationship: relationship || null,
    pendingHomework: pendingHomework.length,
    hasEvidence,
  };
}
