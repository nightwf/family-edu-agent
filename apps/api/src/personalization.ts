import { prisma } from "./prisma.js";
import { listEducationSkills, getEducationSkill } from "./education.js";
import { recommendEducationMethods } from "./education-methods.js";

export async function ensureBaseSkillVersions() {
  const skills = listEducationSkills();
  for (const skill of skills) {
    const content = getEducationSkill(skill.id)?.content || "";
    await prisma.skillVersion.upsert({
      where: { skillId_version: { skillId: skill.id, version: "1.0.0" } },
      update: { content, title: skill.name, status: "active" },
      create: {
        skillId: skill.id,
        version: "1.0.0",
        title: skill.name,
        content,
        status: "active",
        createdBy: "system",
      },
    });
  }
}

export async function listFamilyPolicies(familyId: string) {
  const profiles = await prisma.familySkillProfile.findMany({
    where: { familyId, active: true },
    include: { overrides: true },
  });
  const skills = listEducationSkills();
  return skills.map((skill) => {
    const profile = profiles.find((item) => item.skillId === skill.id) || null;
    return {
      skill_id: skill.id,
      name: skill.name,
      profile,
      defaults: {
        philosophy: "以引导和鼓励为主",
        communication_style: "温和直接",
        strictness: "适中",
        parent_goals: [],
      },
    };
  });
}

export async function getFamilyProfile(familyId: string, skillId: string) {
  return prisma.familySkillProfile.findUnique({
    where: { familyId_skillId: { familyId, skillId } },
    include: { overrides: true },
  });
}

export async function updateFamilyProfile(familyId: string, skillId: string, input: {
  philosophy?: string;
  communicationStyle?: string;
  strictness?: string;
  parentGoals?: string[];
  active?: boolean;
  baseVersion?: string;
}, createdBy = "parent") {
  const before = await getFamilyProfile(familyId, skillId);
  const profile = await prisma.familySkillProfile.upsert({
    where: { familyId_skillId: { familyId, skillId } },
    update: {
      philosophy: input.philosophy,
      communicationStyle: input.communicationStyle,
      strictness: input.strictness,
      parentGoals: input.parentGoals,
      active: input.active,
      baseVersion: input.baseVersion,
    },
    create: {
      familyId,
      skillId,
      philosophy: input.philosophy,
      communicationStyle: input.communicationStyle,
      strictness: input.strictness,
      parentGoals: input.parentGoals || [],
      active: input.active ?? true,
      baseVersion: input.baseVersion || "1.0.0",
    },
  });
  await prisma.policyChange.create({
    data: {
      familyId,
      skillId,
      type: "profile_update",
      summary: `更新 ${skillId} 家庭配置`,
      before: before || undefined,
      after: profile,
      createdBy,
      status: "approved",
      reviewedAt: new Date(),
    },
  });
  return profile;
}

export async function getEffectiveSkill(familyId: string, skillId: string) {
  const base = getEducationSkill(skillId);
  if (!base) return null;
  const [profile, family] = await Promise.all([
    getFamilyProfile(familyId, skillId),
    prisma.family.findUnique({ where: { id: familyId } }),
  ]);
  const customization = profile
    ? [
        `## 家庭个性化配置`,
        ``,
        `- 教育理念：${profile.philosophy || family?.educationPhilosophy || "以引导和鼓励为主"}`,
        `- 沟通风格：${profile.communicationStyle || family?.communicationStyle || "温和直接"}`,
        `- 严格程度：${profile.strictness || family?.strictness || "适中"}`,
        profile.parentGoals?.length ? `- 家长目标：${profile.parentGoals.join("；")}` : `- 家长目标：未设置`,
      ].join("\n")
    : "";
  const recommendedMethods = recommendEducationMethods({
    educationPhilosophy: profile?.philosophy || family?.educationPhilosophy,
    strictness: profile?.strictness || family?.strictness,
    communicationStyle: profile?.communicationStyle || family?.communicationStyle,
  });
  return {
    skill: base,
    profile,
    overrides: profile?.overrides || [],
    recommended_methods: recommendedMethods,
    effective_content: [base.content, customization].filter(Boolean).join("\n\n"),
  };
}

export async function getFamilyEducationSettings(familyId: string) {
  return prisma.family.findUnique({
    where: { id: familyId },
    select: {
      educationPhilosophy: true,
      communicationStyle: true,
      strictness: true,
      parentGoals: true,
    },
  });
}

export async function updateFamilyEducationSettings(familyId: string, input: {
  educationPhilosophy?: string;
  communicationStyle?: string;
  strictness?: string;
  parentGoals?: string[];
}) {
  return prisma.family.update({
    where: { id: familyId },
    data: input,
  });
}

export async function proposePolicyChange(familyId: string, skillId: string, input: {
  type: string;
  summary?: string;
  before?: any;
  after?: any;
  reason?: string;
}, createdBy = "agent") {
  return prisma.policyChange.create({
    data: {
      familyId,
      skillId,
      type: input.type,
      summary: input.summary,
      before: input.before,
      after: input.after,
      reason: input.reason,
      createdBy,
      status: "proposed",
    },
  });
}

export async function reviewPolicyChange(changeId: string, action: "approved" | "ignored", reviewer = "parent") {
  const change = await prisma.policyChange.update({
    where: { id: changeId },
    data: {
      status: action,
      reviewedAt: new Date(),
      effective: action === "approved",
    },
  });
  return change;
}

export async function getPolicyHistory(familyId: string, skillId?: string) {
  return prisma.policyChange.findMany({
    where: { familyId, ...(skillId ? { skillId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function createSkillOverride(familyId: string, skillId: string, input: {
  path: string;
  original_value?: string;
  custom_value: string;
  reason?: string;
}, createdBy = "workbuddy") {
  const profile = await prisma.familySkillProfile.upsert({
    where: { familyId_skillId: { familyId, skillId } },
    update: {},
    create: { familyId, skillId },
  });
  const override = await prisma.skillOverride.create({
    data: {
      profileId: profile.id,
      path: input.path,
      originalValue: input.original_value,
      customValue: input.custom_value,
      reason: input.reason,
      createdBy,
      approvedBy: "parent",
    },
  });
  await prisma.policyChange.create({
    data: {
      familyId,
      skillId,
      type: "skill_override",
      summary: `新增 ${skillId} 覆盖：${input.path}`,
      before: input.original_value,
      after: input.custom_value,
      reason: input.reason,
      createdBy,
      status: "approved",
      reviewedAt: new Date(),
    },
  });
  return override;
}

export async function listSkillOverrides(familyId: string, skillId: string) {
  const profile = await getFamilyProfile(familyId, skillId);
  if (!profile) return [];
  return prisma.skillOverride.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "desc" },
  });
}
