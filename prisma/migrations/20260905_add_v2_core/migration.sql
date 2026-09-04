-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUPERSEDED', 'DRAFT');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'PROPOSED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WeeklyPlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanItemType" AS ENUM ('SCHOOL_HOMEWORK', 'CHILD_TASK', 'PARENT_ACTION', 'AGENT_TASK', 'RETEST');

-- CreateEnum
CREATE TYPE "PlanItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('OBSERVATION', 'WRITING', 'READING', 'HOMEWORK_COMPLETION', 'QUESTION_ATTEMPT', 'RETEST', 'PARENT_NOTE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'CORRECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MethodCategory" AS ENUM ('CORE', 'SCENARIO', 'PHILOSOPHY');

-- CreateEnum
CREATE TYPE "KnowledgeNodeType" AS ENUM ('CHAPTER', 'KNOWLEDGE_POINT', 'CONCEPT', 'EXAMPLE', 'MISCONCEPTION');

-- CreateEnum
CREATE TYPE "KnowledgeRelationType" AS ENUM ('PREREQUISITE_OF', 'CONTAINS', 'RELATED_TO', 'EXAMPLE_OF', 'ERROR_OF');

-- CreateEnum
CREATE TYPE "ChildKnowledgeStatus" AS ENUM ('UNASSESSED', 'LEARNING', 'PARTIAL', 'MASTERED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "FamilyPolicy" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "weeklyTimeBudget" INTEGER,
    "prioritySubjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pressureBoundary" TEXT,
    "parentGoals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "principles" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationMethod" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MethodCategory" NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "applicability" JSONB,
    "risks" JSONB,
    "workflow" JSONB,
    "version" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MethodEffect" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "goalId" TEXT,
    "context" JSONB,
    "outcome" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "evidenceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MethodEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "taskDescription" TEXT,
    "environment" TEXT,
    "observedBehavior" TEXT,
    "frequency" TEXT,
    "effectiveStrategy" TEXT,
    "counterEvidence" TEXT,
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'workbuddy',
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildStateSnapshot" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "periodWindow" TEXT NOT NULL,
    "summary" JSONB,
    "indicators" JSONB,
    "confidence" DOUBLE PRECISION,
    "sourceVersion" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageGoal" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "criteria" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
    "proposedBy" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "methodIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contextVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlan" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "stageGoalId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" "WeeklyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedBy" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "contextVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "weeklyPlanId" TEXT NOT NULL,
    "type" "PlanItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "methodId" TEXT,
    "sourceRef" TEXT,
    "sequence" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER,
    "dueAt" TIMESTAMP(3),
    "status" "PlanItemStatus" NOT NULL DEFAULT 'PENDING',
    "completionEvidence" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChange" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "planId" TEXT,
    "planItemId" TEXT,
    "type" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PlanChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "stageGoalId" TEXT,
    "planItemId" TEXT,
    "title" TEXT NOT NULL,
    "assessmentType" TEXT NOT NULL,
    "criteria" JSONB,
    "score" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "outcome" JSONB,
    "sourceRef" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT,
    "grade" TEXT,
    "publisher" TEXT,
    "version" TEXT,
    "fileKey" TEXT,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeNode" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "parentId" TEXT,
    "type" "KnowledgeNodeType" NOT NULL,
    "subject" TEXT,
    "grade" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB,
    "sourcePage" TEXT,
    "version" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "supersededBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "relationType" "KnowledgeRelationType" NOT NULL,
    "metadata" JSONB,
    "version" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildKnowledgeState" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "status" "ChildKnowledgeStatus" NOT NULL DEFAULT 'UNASSESSED',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "lastPracticedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "manualStatus" TEXT,
    "manualReason" TEXT,
    "manualSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildKnowledgeState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReview" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "draft" JSONB,
    "parentAdjustments" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageReport" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "stageGoalId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "verdict" TEXT,
    "summary" TEXT,
    "evidence" JSONB,
    "nextRecommendations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER,
    "checksum" TEXT,
    "retentionPolicy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "familyId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "familyId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyPolicy_familyId_key" ON "FamilyPolicy"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationMethod_key_key" ON "EducationMethod"("key");

-- CreateIndex
CREATE INDEX "MethodEffect_familyId_childId_methodId_idx" ON "MethodEffect"("familyId", "childId", "methodId");

-- CreateIndex
CREATE INDEX "MethodEffect_goalId_idx" ON "MethodEffect"("goalId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_familyId_childId_observedAt_idx" ON "EvidenceRecord"("familyId", "childId", "observedAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_familyId_childId_type_reviewStatus_idx" ON "EvidenceRecord"("familyId", "childId", "type", "reviewStatus");

-- CreateIndex
CREATE INDEX "ChildStateSnapshot_familyId_childId_generatedAt_idx" ON "ChildStateSnapshot"("familyId", "childId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChildStateSnapshot_childId_periodWindow_asOf_key" ON "ChildStateSnapshot"("childId", "periodWindow", "asOf");

-- CreateIndex
CREATE INDEX "StageGoal_familyId_childId_status_idx" ON "StageGoal"("familyId", "childId", "status");

-- CreateIndex
CREATE INDEX "StageGoal_familyId_childId_startDate_endDate_idx" ON "StageGoal"("familyId", "childId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "WeeklyPlan_familyId_childId_weekStart_idx" ON "WeeklyPlan"("familyId", "childId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlan_stageGoalId_weekStart_key" ON "WeeklyPlan"("stageGoalId", "weekStart");

-- CreateIndex
CREATE INDEX "PlanItem_weeklyPlanId_status_dueAt_idx" ON "PlanItem"("weeklyPlanId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItem_weeklyPlanId_sequence_key" ON "PlanItem"("weeklyPlanId", "sequence");

-- CreateIndex
CREATE INDEX "PlanChange_familyId_status_idx" ON "PlanChange"("familyId", "status");

-- CreateIndex
CREATE INDEX "Assessment_familyId_childId_observedAt_idx" ON "Assessment"("familyId", "childId", "observedAt");

-- CreateIndex
CREATE INDEX "Assessment_stageGoalId_idx" ON "Assessment"("stageGoalId");

-- CreateIndex
CREATE INDEX "SourceDocument_familyId_subject_grade_status_idx" ON "SourceDocument"("familyId", "subject", "grade", "status");

-- CreateIndex
CREATE INDEX "KnowledgeNode_familyId_subject_grade_status_idx" ON "KnowledgeNode"("familyId", "subject", "grade", "status");

-- CreateIndex
CREATE INDEX "KnowledgeNode_familyId_sourceDocumentId_idx" ON "KnowledgeNode"("familyId", "sourceDocumentId");

-- CreateIndex
CREATE INDEX "KnowledgeRelation_familyId_sourceNodeId_relationType_idx" ON "KnowledgeRelation"("familyId", "sourceNodeId", "relationType");

-- CreateIndex
CREATE INDEX "KnowledgeRelation_familyId_targetNodeId_relationType_idx" ON "KnowledgeRelation"("familyId", "targetNodeId", "relationType");

-- CreateIndex
CREATE INDEX "ChildKnowledgeState_familyId_childId_status_idx" ON "ChildKnowledgeState"("familyId", "childId", "status");

-- CreateIndex
CREATE INDEX "ChildKnowledgeState_knowledgeNodeId_status_idx" ON "ChildKnowledgeState"("knowledgeNodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChildKnowledgeState_childId_knowledgeNodeId_key" ON "ChildKnowledgeState"("childId", "knowledgeNodeId");

-- CreateIndex
CREATE INDEX "WeeklyReview_familyId_childId_status_idx" ON "WeeklyReview"("familyId", "childId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReview_childId_weekStart_key" ON "WeeklyReview"("childId", "weekStart");

-- CreateIndex
CREATE INDEX "StageReport_familyId_childId_generatedAt_idx" ON "StageReport"("familyId", "childId", "generatedAt");

-- CreateIndex
CREATE INDEX "StageReport_stageGoalId_idx" ON "StageReport"("stageGoalId");

-- CreateIndex
CREATE INDEX "StoredObject_familyId_status_idx" ON "StoredObject"("familyId", "status");

-- CreateIndex
CREATE INDEX "BackgroundJob_type_status_nextRunAt_idx" ON "BackgroundJob"("type", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AuditLog_familyId_createdAt_idx" ON "AuditLog"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "MethodEffect" ADD CONSTRAINT "MethodEffect_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "EducationMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MethodEffect" ADD CONSTRAINT "MethodEffect_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "StageGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_stageGoalId_fkey" FOREIGN KEY ("stageGoalId") REFERENCES "StageGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_stageGoalId_fkey" FOREIGN KEY ("stageGoalId") REFERENCES "StageGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildKnowledgeState" ADD CONSTRAINT "ChildKnowledgeState_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

