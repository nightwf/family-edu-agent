-- 教育方式/策略按孩子维度分层：同一家庭的不同孩子可以有各自的教育理念、沟通风格、
-- 严格程度和家长目标；孩子级未配置时自动继承家庭级设置。

-- 1) 孩子级教育配置表（对照 FamilySkillProfile，但以 childId 为维度）
CREATE TABLE "ChildSkillProfile" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "baseVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "philosophy" TEXT,
    "communicationStyle" TEXT,
    "strictness" TEXT,
    "parentGoals" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildSkillProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChildSkillProfile_childId_skillId_key" ON "ChildSkillProfile"("childId", "skillId");
CREATE INDEX "ChildSkillProfile_familyId_skillId_idx" ON "ChildSkillProfile"("familyId", "skillId");

ALTER TABLE "ChildSkillProfile"
    ADD CONSTRAINT "ChildSkillProfile_childId_fkey"
    FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 策略变更记录增加 childId，用于区分家庭级变更和孩子级变更
ALTER TABLE "PolicyChange" ADD COLUMN "childId" TEXT;
CREATE INDEX "PolicyChange_familyId_childId_idx" ON "PolicyChange"("familyId", "childId");
