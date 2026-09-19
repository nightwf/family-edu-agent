const SCENES = [
  "/assets/illustrations/scene-home.webp",
  "/assets/illustrations/scene-school.webp",
  "/assets/illustrations/scene-outdoor.webp"
];

const STATE_ASSETS_BY_GENDER = {
  male: {
    stable: "/assets/illustrations/child-stable.png",
    progress: "/assets/illustrations/child-progress.png",
    thinking: "/assets/illustrations/child-thinking.png",
    review: "/assets/illustrations/child-review.png",
    done: "/assets/illustrations/child-done.png"
  },
  female: {
    stable: "/assets/illustrations/child-stable-female.png",
    progress: "/assets/illustrations/child-progress-female.png",
    thinking: "/assets/illustrations/child-thinking-female.png",
    review: "/assets/illustrations/child-review-female.png",
    done: "/assets/illustrations/child-done-female.png"
  }
};

const STATE_ASSETS = STATE_ASSETS_BY_GENDER.male;

/**
 * 已上线的女生素材状态。生成一张就登记一张，未登记的状态自动回退到男生素材，
 * 避免孩子选了女生但页面出现空白。测试会校验这里与实际文件保持一致。
 */
const FEMALE_READY_STATES = ["stable", "progress", "thinking", "review", "done"];

function normalizedGender(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

function hasFemaleAsset(state) {
  return FEMALE_READY_STATES.includes(state);
}

function characterAssets(gender) {
  return STATE_ASSETS_BY_GENDER[normalizedGender(gender)];
}

function stateAsset(state, gender) {
  const wanted = normalizedGender(gender);
  const assets = STATE_ASSETS_BY_GENDER[wanted];
  if (wanted === "female" && !hasFemaleAsset(state)) return STATE_ASSETS_BY_GENDER.male[state] || STATE_ASSETS_BY_GENDER.male.stable;
  return assets[state] || assets.stable;
}

function stableHash(value) {
  let result = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    result = ((result << 5) - result + text.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dailyScene(childId, value) {
  return SCENES[stableHash(`${dateKey(value)}:${childId || "family"}`) % SCENES.length];
}

function statusLabel(status) {
  const labels = { unassessed: "待评估", learning: "学习中", basic: "基本掌握", mastered: "已掌握", needs_review: "待复测" };
  return labels[status] || "观察中";
}

function textFromWrong(item) {
  if (!item) return "";
  if (item.questionType && item.questionType.name) return item.questionType.name;
  if (Array.isArray(item.knowledgePoints) && item.knowledgePoints[0]) return item.knowledgePoints[0];
  return item.subject || "错题";
}

function deriveChildPresentation(input) {
  const child = input.child || null;
  const childState = input.childState || null;
  const relationship = input.relationship || null;
  const wrongItems = (input.wrongQuestions && input.wrongQuestions.items) || [];
  const masteryItems = (input.mastery && input.mastery.items) || [];
  const reports = input.reports || [];
  const homework = input.homework || [];
  const summary = (childState && childState.summary) || {};
  const activeGoal = childState && childState.active_goal;
  const openWrong = wrongItems.filter((item) => !["mastered", "archived"].includes(item.status));
  const weakest = masteryItems.filter((item) => item && item.questionType).slice()
    .sort((a, b) => Number(a.masteryScore || 0) - Number(b.masteryScore || 0))[0];
  const pendingHomework = homework.filter((item) => !["done", "cancelled"].includes(item.status));
  const evidenceCount = Number(summary.evidence_7d || 0);
  const hasEvidence = evidenceCount > 0 || wrongItems.length > 0 || masteryItems.length > 0 || reports.length > 0;

  if (!child) {
    return {
      state: "stable", image: stateAsset("stable", null), title: "先建立孩子档案",
      subtitle: "有了档案，学习记录才能准确归到同一个孩子名下", tags: ["等待建档"],
      evidence: "当前没有可分析的学生数据", judgment: "尚不能判断孩子的学习状态",
      action: "先添加学生，再让 WorkBuddy 同步真实学习记录", weakness: null,
      activeGoal: null, relationship: null, pendingHomework: 0, hasEvidence: false
    };
  }

  let state = "stable";
  if (openWrong.some((item) => item.status === "needs_review")) state = "review";
  else if (openWrong.length || (weakest && Number(weakest.masteryScore || 0) < 60)) state = "thinking";
  else if (weakest && Number(weakest.masteryScore || 0) >= 80) state = "progress";
  else if (pendingHomework.length === 0 && hasEvidence) state = "done";

  const weaknessName = openWrong.length ? textFromWrong(openWrong[0]) : weakest && weakest.questionType ? weakest.questionType.name : "";
  const masteryScore = weakest && Number.isFinite(Number(weakest.masteryScore)) ? Math.round(Number(weakest.masteryScore)) : null;
  const tags = [];
  if (openWrong.length) tags.push(`${openWrong.length} 个错题点`);
  if (weakest) tags.push(`${statusLabel(weakest.status)}${masteryScore === null ? "" : ` ${masteryScore}分`}`);
  if (relationship && relationship.status) tags.push(`亲子关系 ${relationship.status}`);
  if (!tags.length) tags.push(hasEvidence ? "状态稳定" : "等待更多记录");

  return {
    state,
    image: stateAsset(state, child.gender),
    title: hasEvidence ? `${child.name}，${state === "progress" ? "正在进步" : state === "review" ? "该复测了" : state === "thinking" ? "正在巩固" : state === "done" ? "本轮已完成" : "状态平稳"}` : `${child.name}，等待更多学习记录`,
    subtitle: weaknessName ? `当前最值得关注：${weaknessName}` : "当前没有足够证据确认具体薄弱点",
    tags: tags.slice(0, 3),
    evidence: `近 7 天 ${evidenceCount} 条证据 · ${openWrong.length} 个待处理错题 · ${pendingHomework.length} 项未完成`,
    judgment: weaknessName ? `${weaknessName}${masteryScore === null ? "仍需结合后续练习确认" : `当前掌握度 ${masteryScore} 分`}` : "现有数据不足以给出具体薄弱判断",
    action: activeGoal && (activeGoal.objective || activeGoal.title)
      ? (activeGoal.objective || activeGoal.title)
      : weaknessName ? `让 WorkBuddy 围绕“${weaknessName}”安排一次订正和变式复测` : "继续同步真实作业、错题和阅读记录，形成可验证的学习证据",
    weakness: weaknessName ? { name: weaknessName, score: masteryScore, count: openWrong.length } : null,
    activeGoal: activeGoal || null,
    relationship: relationship || null,
    pendingHomework: pendingHomework.length,
    hasEvidence
  };
}

function shouldAnimate(deviceInfo) {
  if (!deviceInfo) return true;
  const benchmark = Number(deviceInfo.benchmarkLevel);
  return !Number.isFinite(benchmark) || benchmark < 0 || benchmark >= 10;
}

module.exports = {
  SCENES,
  STATE_ASSETS,
  STATE_ASSETS_BY_GENDER,
  FEMALE_READY_STATES,
  hasFemaleAsset,
  characterAssets,
  stateAsset,
  normalizedGender,
  dailyScene,
  deriveChildPresentation,
  shouldAnimate,
  dateKey
};
