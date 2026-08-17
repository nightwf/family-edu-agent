export type EducationMethod = {
  id: string;
  name: string;
  principle: string;
  suitableFor: string[];
  workflow: string[];
};

export const EDUCATION_METHODS: EducationMethod[] = [
  {
    id: "feynman",
    name: "费曼学习法",
    principle: "通过让孩子把概念讲清楚，暴露理解漏洞。",
    suitableFor: ["重视理解", "自主探索", "兴趣优先"],
    workflow: ["解释概念", "找出说不清的地方", "回到材料重新理解", "用更简单的方式再讲一遍"],
  },
  {
    id: "socratic",
    name: "苏格拉底式提问",
    principle: "通过连续提问，引导孩子自己找到答案。",
    suitableFor: ["以引导和鼓励为主", "重视理解", "陪伴讨论"],
    workflow: ["先问孩子怎么看", "追问原因", "给出反例或对比", "让孩子自己修正结论"],
  },
  {
    id: "scaffolded",
    name: "脚手架式引导",
    principle: "先示范，再逐步减少帮助，直到孩子独立完成。",
    suitableFor: ["习惯优先", "成绩与能力并重", "鼓励为主"],
    workflow: ["先给一个示例", "让孩子完成中间步骤", "只提示不代做", "最后让孩子完整独立完成"],
  },
  {
    id: "montessori_inspired",
    name: "自主探索模式",
    principle: "参考蒙氏理念，提供选择、环境和反馈，减少强制干预。",
    suitableFor: ["自主探索", "兴趣优先", "宽松"],
    workflow: ["让孩子选择任务", "给清晰步骤和工具", "家长观察并记录", "完成后一起复盘"],
  },
  {
    id: "project_based",
    name: "项目式学习",
    principle: "围绕一个真实问题或小项目，跨学科完成学习。",
    suitableFor: ["兴趣优先", "自主探索", "成绩与能力并重"],
    workflow: ["提出真实问题", "制定小计划", "查找资料并实践", "展示和复盘"],
  },
];

function methodMatches(method: EducationMethod, philosophy: string, strictness: string) {
  return method.suitableFor.some((tag) => philosophy.includes(tag) || strictness.includes(tag) || tag.includes(philosophy));
}

export function recommendEducationMethods(settings: {
  educationPhilosophy?: string | null;
  strictness?: string | null;
  communicationStyle?: string | null;
}) {
  const philosophy = settings.educationPhilosophy || "以引导和鼓励为主";
  const strictness = settings.strictness || "适中";
  const preferred: EducationMethod[] = [];
  const fallback: EducationMethod[] = [];

  for (const method of EDUCATION_METHODS) {
    if (methodMatches(method, philosophy, strictness)) {
      preferred.push(method);
    } else {
      fallback.push(method);
    }
  }

  const selected = preferred.slice(0, 3);
  if (selected.length < 2) {
    selected.push(...fallback.slice(0, 2 - selected.length));
  }
  return selected;
}
