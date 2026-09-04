import { prisma } from "../prisma.js";
import { writeAudit } from "./audit.js";

export type SeedMethod = {
  key: string;
  name: string;
  category: "CORE" | "SCENARIO" | "PHILOSOPHY";
  evidenceLevel: string;
  description: string;
  applicability: Record<string, unknown>;
  risks: Record<string, unknown>;
  workflow: string[];
};

export const SEED_METHODS: SeedMethod[] = [
  {
    key: "warm-and-structured",
    name: "温暖回应与清晰边界",
    category: "CORE",
    evidenceLevel: "high",
    description: "同时提供情感支持和稳定、明确的行为边界。",
    applicability: { ages: "6-12", contexts: ["作业启动", "错误订正", "家庭规则"] },
    risks: { failure: "只给边界缺少温暖会变成高压管教" },
    workflow: ["确认情绪", "说明规则", "提供选择", "保持边界", "完成复盘"],
  },
  {
    key: "explicit-teaching-scaffold",
    name: "明确教学与脚手架",
    category: "CORE",
    evidenceLevel: "high",
    description: "先示范和讲解，再逐步撤除帮助，直到孩子独立完成。",
    applicability: { ages: "6-12", contexts: ["新知识", "应用题", "写作结构"] },
    risks: { failure: "脚手架长期不撤除会阻碍独立能力" },
    workflow: ["明确目标", "示范完整步骤", "共同完成", "逐步撤除提示", "独立复测"],
  },
  {
    key: "mastery-learning",
    name: "掌握学习",
    category: "CORE",
    evidenceLevel: "moderate",
    description: "达到明确掌握标准后再进入下一阶段，并通过复测维持效果。",
    applicability: { ages: "6-12", contexts: ["数学计算", "字词", "基础语法"] },
    risks: { failure: "标准过高会造成长时间重复和挫败" },
    workflow: ["拆解前置知识", "形成性测试", "补足缺口", "达到标准", "延迟复测"],
  },
  {
    key: "spaced-retrieval",
    name: "间隔与提取练习",
    category: "CORE",
    evidenceLevel: "high",
    description: "间隔安排主动回忆，而不是连续重复和被动重读。",
    applicability: { ages: "6-12", contexts: ["字词", "口诀", "知识点复测"] },
    risks: { failure: "间隔过短会退化为机械刷题" },
    workflow: ["学习后短间隔回忆", "增加间隔", "穿插旧知识", "根据错误调整频率"],
  },
  {
    key: "feynman-retelling",
    name: "费曼复述",
    category: "SCENARIO",
    evidenceLevel: "moderate",
    description: "通过让孩子讲解来暴露理解漏洞。",
    applicability: { ages: "8-12", contexts: ["概念理解", "阅读复述", "错题讲解"] },
    risks: { failure: "对还不具备表达能力的低龄孩子效果有限" },
    workflow: ["讲解概念", "找到说不清处", "回到材料", "用更简单语言再讲"],
  },
  {
    key: "socratic-questioning",
    name: "苏格拉底式提问",
    category: "SCENARIO",
    evidenceLevel: "moderate",
    description: "通过问题链引导孩子自己发现并修正错误。",
    applicability: { ages: "8-12", contexts: ["阅读理解", "推理", "策略选择"] },
    risks: { failure: "问题过多会变成审问，孩子更容易失去耐心" },
    workflow: ["先问理解", "追问原因", "提供反例", "让孩子修正"],
  },
];

export async function ensureEducationMethods() {
  for (const method of SEED_METHODS) {
    await prisma.educationMethod.upsert({
      where: { key: method.key },
      update: {
        name: method.name,
        category: method.category,
        evidenceLevel: method.evidenceLevel,
        description: method.description,
        applicability: method.applicability as any,
        risks: method.risks as any,
        workflow: method.workflow,
      },
      create: {
        key: method.key,
        name: method.name,
        category: method.category,
        evidenceLevel: method.evidenceLevel,
        description: method.description,
        applicability: method.applicability as any,
        risks: method.risks as any,
        workflow: method.workflow,
        version: "1.0.0",
      },
    });
  }
}

export async function listEducationMethods(filters: {
  category?: string;
  status?: string;
} = {}) {
  return prisma.educationMethod.findMany({
    where: {
      ...(filters.category ? { category: filters.category as any } : {}),
      ...(filters.status ? { status: filters.status as any } : { status: "ACTIVE" }),
    },
    orderBy: [{ category: "asc" }, { evidenceLevel: "desc" }, { name: "asc" }],
  });
}

export async function getEducationMethod(methodId: string) {
  return prisma.educationMethod.findUnique({ where: { id: methodId } });
}

export async function saveMethodEffect(
  familyId: string,
  input: {
    childId: string;
    methodId: string;
    goalId?: string | null;
    outcome: string;
    context?: Record<string, unknown> | null;
    confidence?: number | null;
    evidenceRef?: string | null;
  },
  actor: { type: string; id?: string } = { type: "workbuddy" },
) {
  const child = await prisma.child.findFirst({ where: { id: input.childId, familyId } });
  if (!child) throw new Error("学生不存在或不属于当前家庭");
  const method = await prisma.educationMethod.findUnique({ where: { id: input.methodId } });
  if (!method) throw new Error("教育方法不存在");

  const effect = await prisma.methodEffect.create({
    data: {
      familyId,
      childId: input.childId,
      methodId: input.methodId,
      goalId: input.goalId,
      outcome: input.outcome,
      context: (input.context ?? undefined) as any,
      confidence: input.confidence,
      evidenceRef: input.evidenceRef,
    },
  });

  await writeAudit({
    familyId,
    actorType: actor.type,
    actorId: actor.id,
    action: "method_effect.create",
    entityType: "MethodEffect",
    entityId: effect.id,
    after: effect,
  });

  return effect;
}
