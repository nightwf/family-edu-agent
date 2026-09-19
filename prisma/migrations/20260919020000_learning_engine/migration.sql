-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "verificationErrors" JSONB,
ADD COLUMN     "verificationMethod" TEXT,
ADD COLUMN     "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
ADD COLUMN     "verifiedAnswer" JSONB,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuestionTypeKnowledgeNode" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "questionTypeId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionTypeKnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionKnowledgeNode" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionKnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSignal" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT NOT NULL,
    "knowledgeNodeId" TEXT,
    "questionTypeId" TEXT,
    "wrongQuestionId" TEXT,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LearningSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningRequest" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'system',
    "triggerReason" TEXT NOT NULL,
    "signalIds" JSONB,
    "prioritySnapshot" JSONB,
    "note" TEXT,
    "stageGoalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PlanningRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationOutcome" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metrics" JSONB,
    "note" TEXT,
    "measuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionTypeKnowledgeNode_familyId_knowledgeNodeId_idx" ON "QuestionTypeKnowledgeNode"("familyId", "knowledgeNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionTypeKnowledgeNode_questionTypeId_knowledgeNodeId_key" ON "QuestionTypeKnowledgeNode"("questionTypeId", "knowledgeNodeId");

-- CreateIndex
CREATE INDEX "QuestionKnowledgeNode_familyId_knowledgeNodeId_idx" ON "QuestionKnowledgeNode"("familyId", "knowledgeNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionKnowledgeNode_questionId_knowledgeNodeId_key" ON "QuestionKnowledgeNode"("questionId", "knowledgeNodeId");

-- CreateIndex
CREATE INDEX "LearningSignal_familyId_childId_status_severity_idx" ON "LearningSignal"("familyId", "childId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSignal_childId_dedupeKey_key" ON "LearningSignal"("childId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PlanningRequest_familyId_childId_status_idx" ON "PlanningRequest"("familyId", "childId", "status");

-- CreateIndex
CREATE INDEX "RecommendationOutcome_familyId_childId_sourceType_sourceId_idx" ON "RecommendationOutcome"("familyId", "childId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "QuestionTypeKnowledgeNode" ADD CONSTRAINT "QuestionTypeKnowledgeNode_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTypeKnowledgeNode" ADD CONSTRAINT "QuestionTypeKnowledgeNode_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgeNode" ADD CONSTRAINT "QuestionKnowledgeNode_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgeNode" ADD CONSTRAINT "QuestionKnowledgeNode_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSignal" ADD CONSTRAINT "LearningSignal_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningRequest" ADD CONSTRAINT "PlanningRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationOutcome" ADD CONSTRAINT "RecommendationOutcome_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

