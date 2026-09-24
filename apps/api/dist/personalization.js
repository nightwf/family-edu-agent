import { prisma } from "./prisma.js";
import { listEducationSkills, getEducationSkill } from "./education.js";
import { recommendEducationMethods } from "./education-methods.js";
import { assertChildInFamily } from "./v2/guards.js";
const DEFAULT_PHILOSOPHY = "以引导和鼓励为主";
const DEFAULT_COMMUNICATION_STYLE = "温和直接";
const DEFAULT_STRICTNESS = "适中";
/**
 * 三层解析：全局基础技能 → 家庭策略 → 孩子级调整。
 * 孩子级未配置的字段逐项回落到家庭级，家庭级再回落到默认值。
 */
function resolveEducationLayers(family, profile, childProfile) {
    const familySettings = {
        philosophy: profile?.philosophy || family?.educationPhilosophy || DEFAULT_PHILOSOPHY,
        communicationStyle: profile?.communicationStyle || family?.communicationStyle || DEFAULT_COMMUNICATION_STYLE,
        strictness: profile?.strictness || family?.strictness || DEFAULT_STRICTNESS,
        parentGoals: (profile?.parentGoals ?? []),
    };
    const effective = {
        philosophy: childProfile?.philosophy || familySettings.philosophy,
        communicationStyle: childProfile?.communicationStyle || familySettings.communicationStyle,
        strictness: childProfile?.strictness || familySettings.strictness,
        parentGoals: childProfile?.parentGoals?.length ? childProfile.parentGoals : familySettings.parentGoals,
    };
    const childOverrides = ["philosophy", "communicationStyle", "strictness"].filter((key) => Boolean(childProfile?.[key]) && childProfile?.[key] !== familySettings[key]);
    if (childProfile?.parentGoals?.length)
        childOverrides.push("parentGoals");
    return { familySettings, effective, childOverrides };
}
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
export async function listFamilyPolicies(familyId, childId) {
    const [profiles, child, childProfiles] = await Promise.all([
        prisma.familySkillProfile.findMany({
            where: { familyId, active: true },
            include: { overrides: true },
        }),
        childId ? assertChildInFamily(familyId, childId) : Promise.resolve(null),
        childId ? prisma.childSkillProfile.findMany({ where: { familyId, childId } }) : Promise.resolve([]),
    ]);
    const skills = listEducationSkills();
    return skills.map((skill) => {
        const profile = profiles.find((item) => item.skillId === skill.id) || null;
        const childProfile = childProfiles.find((item) => item.skillId === skill.id) || null;
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
            ...(child
                ? {
                    child_id: child.id,
                    child_name: child.name,
                    child_profile: childProfile,
                }
                : {}),
        };
    });
}
export async function getFamilyProfile(familyId, skillId) {
    return prisma.familySkillProfile.findUnique({
        where: { familyId_skillId: { familyId, skillId } },
        include: { overrides: true },
    });
}
export async function getChildProfile(familyId, childId, skillId) {
    await assertChildInFamily(familyId, childId);
    return prisma.childSkillProfile.findUnique({
        where: { childId_skillId: { childId, skillId } },
    });
}
export async function listChildProfiles(familyId, childId) {
    const child = await assertChildInFamily(familyId, childId);
    const [profiles, familyProfiles, family] = await Promise.all([
        prisma.childSkillProfile.findMany({ where: { childId, familyId } }),
        prisma.familySkillProfile.findMany({ where: { familyId, active: true } }),
        prisma.family.findUnique({ where: { id: familyId } }),
    ]);
    return listEducationSkills().map((skill) => {
        const childProfile = profiles.find((item) => item.skillId === skill.id) || null;
        const familyProfile = familyProfiles.find((item) => item.skillId === skill.id) || null;
        const { familySettings, effective, childOverrides } = resolveEducationLayers(family, familyProfile, childProfile);
        return {
            skill_id: skill.id,
            name: skill.name,
            child_id: child.id,
            child_name: child.name,
            profile: childProfile,
            inherited_from_family: familySettings,
            effective_settings: effective,
            child_overrides: childOverrides,
            inherits_family: childOverrides.length === 0,
        };
    });
}
export async function updateChildProfile(familyId, childId, skillId, input, createdBy = "parent") {
    const child = await assertChildInFamily(familyId, childId);
    const before = await prisma.childSkillProfile.findUnique({
        where: { childId_skillId: { childId, skillId } },
    });
    const profile = await prisma.childSkillProfile.upsert({
        where: { childId_skillId: { childId, skillId } },
        update: {
            philosophy: input.philosophy,
            communicationStyle: input.communicationStyle,
            strictness: input.strictness,
            parentGoals: input.parentGoals,
            notes: input.notes,
            active: input.active,
        },
        create: {
            childId,
            familyId,
            skillId,
            philosophy: input.philosophy,
            communicationStyle: input.communicationStyle,
            strictness: input.strictness,
            parentGoals: input.parentGoals || [],
            notes: input.notes,
            active: input.active ?? true,
        },
    });
    await prisma.policyChange.create({
        data: {
            familyId,
            childId,
            skillId,
            type: "child_profile_update",
            summary: `更新 ${child.name} 的 ${skillId} 教育方式`,
            before: before || undefined,
            after: profile,
            createdBy,
            status: "approved",
            reviewedAt: new Date(),
        },
    });
    return profile;
}
/** 清空孩子级配置，回到继承家庭设置的状态。 */
export async function clearChildProfile(familyId, childId, skillId, createdBy = "parent") {
    const child = await assertChildInFamily(familyId, childId);
    const before = await prisma.childSkillProfile.findUnique({
        where: { childId_skillId: { childId, skillId } },
    });
    if (!before)
        return null;
    await prisma.childSkillProfile.delete({ where: { childId_skillId: { childId, skillId } } });
    await prisma.policyChange.create({
        data: {
            familyId,
            childId,
            skillId,
            type: "child_profile_clear",
            summary: `${child.name} 的 ${skillId} 教育方式恢复继承家庭设置`,
            before,
            createdBy,
            status: "approved",
            reviewedAt: new Date(),
        },
    });
    return { ok: true };
}
export async function updateFamilyProfile(familyId, skillId, input, createdBy = "parent") {
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
/**
 * 读取最终生效的教育 Skill。
 *
 * 解析顺序：全局基础技能 → 家庭策略 → 孩子级调整。
 * 传入 child_id 时，孩子级配置覆盖家庭级配置；不传时行为与历史版本一致。
 */
export async function getEffectiveSkill(familyId, skillId, childId) {
    const base = getEducationSkill(skillId);
    if (!base)
        return null;
    const [profile, family, child, rawChildProfile] = await Promise.all([
        getFamilyProfile(familyId, skillId),
        prisma.family.findUnique({ where: { id: familyId } }),
        childId ? assertChildInFamily(familyId, childId) : Promise.resolve(null),
        childId
            ? prisma.childSkillProfile.findUnique({ where: { childId_skillId: { childId, skillId } } })
            : Promise.resolve(null),
    ]);
    const childProfile = rawChildProfile && rawChildProfile.active !== false ? rawChildProfile : null;
    const { familySettings, effective, childOverrides } = resolveEducationLayers(family, profile, childProfile);
    const familyCustomization = profile
        ? [
            `## 家庭个性化配置`,
            ``,
            `- 教育理念：${familySettings.philosophy}`,
            `- 沟通风格：${familySettings.communicationStyle}`,
            `- 严格程度：${familySettings.strictness}`,
            familySettings.parentGoals.length ? `- 家长目标：${familySettings.parentGoals.join("；")}` : `- 家长目标：未设置`,
        ].join("\n")
        : "";
    const childCustomization = childProfile
        ? [
            `## 孩子个体差异配置（在孩子维度覆盖家庭设置）`,
            ``,
            `- 孩子：${child?.name || childId}`,
            `- 教育理念：${effective.philosophy}`,
            `- 沟通风格：${effective.communicationStyle}`,
            `- 严格程度：${effective.strictness}`,
            effective.parentGoals.length ? `- 家长目标：${effective.parentGoals.join("；")}` : `- 家长目标：未设置`,
            childProfile.notes ? `- 孩子学习特点：${childProfile.notes}` : "",
            ``,
            `说明：本节是针对这个孩子的调整；与家庭配置不一致时，以本节为准。`,
        ]
            .filter(Boolean)
            .join("\n")
        : "";
    const recommendedMethods = recommendEducationMethods({
        educationPhilosophy: effective.philosophy,
        strictness: effective.strictness,
        communicationStyle: effective.communicationStyle,
    });
    const hasFamilyConfig = Boolean(profile || family?.educationPhilosophy || family?.communicationStyle || family?.strictness);
    return {
        skill: base,
        profile,
        overrides: profile?.overrides || [],
        recommended_methods: recommendedMethods,
        effective_content: [base.content, familyCustomization, childCustomization].filter(Boolean).join("\n\n"),
        child_id: child?.id || null,
        child_name: child?.name || null,
        child_profile: childProfile,
        child_overrides: childOverrides,
        resolved_settings: effective,
        resolution: childProfile ? "child" : hasFamilyConfig ? "family" : "default",
    };
}
export async function getFamilyEducationSettings(familyId) {
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
export async function updateFamilyEducationSettings(familyId, input) {
    return prisma.family.update({
        where: { id: familyId },
        data: input,
    });
}
export async function proposePolicyChange(familyId, skillId, input, createdBy = "agent") {
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
export async function reviewPolicyChange(changeId, action, reviewer = "parent") {
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
export async function getPolicyHistory(familyId, skillId) {
    return prisma.policyChange.findMany({
        where: { familyId, ...(skillId ? { skillId } : {}) },
        orderBy: { createdAt: "desc" },
    });
}
export async function createSkillOverride(familyId, skillId, input, createdBy = "workbuddy") {
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
export async function listSkillOverrides(familyId, skillId) {
    const profile = await getFamilyProfile(familyId, skillId);
    if (!profile)
        return [];
    return prisma.skillOverride.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
    });
}
