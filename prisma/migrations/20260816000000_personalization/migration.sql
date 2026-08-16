-- CreateTable
CREATE TABLE "SkillVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilySkillProfile" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "baseVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "philosophy" TEXT,
    "communicationStyle" TEXT,
    "strictness" TEXT,
    "parentGoals" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilySkillProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillOverride" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "originalValue" TEXT,
    "customValue" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyChange" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skillId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "effective" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PolicyChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillVersion_skillId_version_key" ON "SkillVersion"("skillId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FamilySkillProfile_familyId_skillId_key" ON "FamilySkillProfile"("familyId", "skillId");

-- AddForeignKey
ALTER TABLE "SkillOverride" ADD CONSTRAINT "SkillOverride_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FamilySkillProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

