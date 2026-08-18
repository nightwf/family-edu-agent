ALTER TABLE "QuestionAttempt"
ADD COLUMN "wrongQuestionId" TEXT,
ADD COLUMN "practicePaperId" TEXT,
ADD COLUMN "isOriginalCorrection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isIndependent" BOOLEAN,
ADD COLUMN "variationType" TEXT,
ADD COLUMN "sessionId" TEXT;

CREATE TABLE "WrongQuestionEntry" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionTypeId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT,
    "textbook" TEXT,
    "chapter" TEXT,
    "knowledgePoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "latestSourceAttemptId" TEXT,
    "latestWrongAnswer" JSONB,
    "errorReason" TEXT,
    "errorCategory" TEXT,
    "workbuddyAnalysis" TEXT,
    "correctionMethod" TEXT,
    "keyLearningPoint" TEXT,
    "firstWrongAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWrongAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mistakeCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending_correction',
    "calculatedStatus" TEXT NOT NULL DEFAULT 'pending_correction',
    "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "masteryEvidence" JSONB,
    "nextReviewAt" TIMESTAMP(3),
    "masteredAt" TIMESTAMP(3),
    "manualStatus" TEXT,
    "manualReason" TEXT,
    "manualSource" TEXT,
    "source" TEXT NOT NULL DEFAULT 'workbuddy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WrongQuestionEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticePaper" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "grade" TEXT,
    "objective" TEXT,
    "diagnosisSummary" TEXT,
    "difficultyDistribution" JSONB,
    "estimatedMinutes" INTEGER,
    "totalScore" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'workbuddy',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticePaper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticePaperQuestion" (
    "id" TEXT NOT NULL,
    "practicePaperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "wrongQuestionId" TEXT,
    "section" TEXT,
    "sequence" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "purpose" TEXT,
    "targetErrorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticePaperQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemediationPlan" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "diagnosis" JSONB,
    "objectives" JSONB,
    "strategy" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'workbuddy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RemediationPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemediationTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "wrongQuestionId" TEXT,
    "questionTypeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completionEvidence" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RemediationTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WrongQuestionEntry_latestSourceAttemptId_key" ON "WrongQuestionEntry"("latestSourceAttemptId");
CREATE UNIQUE INDEX "WrongQuestionEntry_childId_questionId_key" ON "WrongQuestionEntry"("childId", "questionId");
CREATE INDEX "WrongQuestionEntry_familyId_childId_status_idx" ON "WrongQuestionEntry"("familyId", "childId", "status");
CREATE INDEX "WrongQuestionEntry_familyId_subject_lastWrongAt_idx" ON "WrongQuestionEntry"("familyId", "subject", "lastWrongAt");
CREATE INDEX "WrongQuestionEntry_questionTypeId_idx" ON "WrongQuestionEntry"("questionTypeId");
CREATE INDEX "PracticePaper_familyId_childId_status_idx" ON "PracticePaper"("familyId", "childId", "status");
CREATE INDEX "PracticePaper_familyId_subject_generatedAt_idx" ON "PracticePaper"("familyId", "subject", "generatedAt");
CREATE UNIQUE INDEX "PracticePaperQuestion_practicePaperId_sequence_key" ON "PracticePaperQuestion"("practicePaperId", "sequence");
CREATE INDEX "PracticePaperQuestion_questionId_idx" ON "PracticePaperQuestion"("questionId");
CREATE INDEX "PracticePaperQuestion_wrongQuestionId_idx" ON "PracticePaperQuestion"("wrongQuestionId");
CREATE INDEX "RemediationPlan_familyId_childId_status_idx" ON "RemediationPlan"("familyId", "childId", "status");
CREATE INDEX "RemediationPlan_familyId_subject_startDate_idx" ON "RemediationPlan"("familyId", "subject", "startDate");
CREATE UNIQUE INDEX "RemediationTask_planId_sequence_key" ON "RemediationTask"("planId", "sequence");
CREATE INDEX "RemediationTask_wrongQuestionId_idx" ON "RemediationTask"("wrongQuestionId");
CREATE INDEX "RemediationTask_questionTypeId_idx" ON "RemediationTask"("questionTypeId");
CREATE INDEX "RemediationTask_status_dueAt_idx" ON "RemediationTask"("status", "dueAt");
CREATE INDEX "QuestionAttempt_wrongQuestionId_attemptedAt_idx" ON "QuestionAttempt"("wrongQuestionId", "attemptedAt");
CREATE INDEX "QuestionAttempt_practicePaperId_idx" ON "QuestionAttempt"("practicePaperId");

ALTER TABLE "WrongQuestionEntry" ADD CONSTRAINT "WrongQuestionEntry_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WrongQuestionEntry" ADD CONSTRAINT "WrongQuestionEntry_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WrongQuestionEntry" ADD CONSTRAINT "WrongQuestionEntry_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WrongQuestionEntry" ADD CONSTRAINT "WrongQuestionEntry_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WrongQuestionEntry" ADD CONSTRAINT "WrongQuestionEntry_latestSourceAttemptId_fkey" FOREIGN KEY ("latestSourceAttemptId") REFERENCES "QuestionAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PracticePaper" ADD CONSTRAINT "PracticePaper_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticePaper" ADD CONSTRAINT "PracticePaper_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticePaperQuestion" ADD CONSTRAINT "PracticePaperQuestion_practicePaperId_fkey" FOREIGN KEY ("practicePaperId") REFERENCES "PracticePaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticePaperQuestion" ADD CONSTRAINT "PracticePaperQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PracticePaperQuestion" ADD CONSTRAINT "PracticePaperQuestion_wrongQuestionId_fkey" FOREIGN KEY ("wrongQuestionId") REFERENCES "WrongQuestionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemediationTask" ADD CONSTRAINT "RemediationTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemediationTask" ADD CONSTRAINT "RemediationTask_wrongQuestionId_fkey" FOREIGN KEY ("wrongQuestionId") REFERENCES "WrongQuestionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RemediationTask" ADD CONSTRAINT "RemediationTask_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_wrongQuestionId_fkey" FOREIGN KEY ("wrongQuestionId") REFERENCES "WrongQuestionEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_practicePaperId_fkey" FOREIGN KEY ("practicePaperId") REFERENCES "PracticePaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;
