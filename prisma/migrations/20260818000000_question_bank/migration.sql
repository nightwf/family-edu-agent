CREATE TABLE "QuestionType" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "textbook" TEXT,
    "chapter" TEXT,
    "knowledgePoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "abilityGoal" TEXT,
    "solutionMethod" TEXT,
    "standardSteps" JSONB,
    "commonErrors" JSONB,
    "invariants" JSONB,
    "variableParameters" JSONB,
    "difficultyLevels" JSONB,
    "generationRule" JSONB,
    "answerValidation" JSONB,
    "masteryCriteria" JSONB,
    "ruleVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuestionType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "questionTypeId" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'short_answer',
    "options" JSONB,
    "answer" JSONB,
    "solution" TEXT,
    "scoringRubric" JSONB,
    "difficulty" TEXT NOT NULL DEFAULT 'basic',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'workbuddy',
    "originalContent" TEXT,
    "fileKey" TEXT,
    "sourceQuestionId" TEXT,
    "generationRuleVersion" TEXT,
    "variationType" TEXT,
    "generatedByWorkbuddy" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionAttempt" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "questionTypeId" TEXT NOT NULL,
    "studentAnswer" JSONB,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "durationSeconds" INTEGER,
    "usedHint" BOOLEAN NOT NULL DEFAULT false,
    "hintCount" INTEGER NOT NULL DEFAULT 0,
    "errorReason" TEXT,
    "evaluation" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentQuestionTypeMastery" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "questionTypeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unassessed',
    "calculatedStatus" TEXT NOT NULL DEFAULT 'unassessed',
    "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "correctRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "independentAttempts" INTEGER NOT NULL DEFAULT 0,
    "variationCount" INTEGER NOT NULL DEFAULT 0,
    "transferScore" DOUBLE PRECISION,
    "lastPracticedAt" TIMESTAMP(3),
    "lastAssessedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "evidence" JSONB,
    "manualStatus" TEXT,
    "manualReason" TEXT,
    "manualSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentQuestionTypeMastery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuestionType_familyId_subject_grade_idx" ON "QuestionType"("familyId", "subject", "grade");
CREATE INDEX "QuestionType_familyId_status_idx" ON "QuestionType"("familyId", "status");
CREATE INDEX "Question_familyId_questionTypeId_status_idx" ON "Question"("familyId", "questionTypeId", "status");
CREATE INDEX "Question_familyId_difficulty_idx" ON "Question"("familyId", "difficulty");
CREATE INDEX "Question_sourceQuestionId_idx" ON "Question"("sourceQuestionId");
CREATE INDEX "QuestionAttempt_familyId_childId_attemptedAt_idx" ON "QuestionAttempt"("familyId", "childId", "attemptedAt");
CREATE INDEX "QuestionAttempt_childId_questionTypeId_attemptedAt_idx" ON "QuestionAttempt"("childId", "questionTypeId", "attemptedAt");
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");
CREATE UNIQUE INDEX "StudentQuestionTypeMastery_childId_questionTypeId_key" ON "StudentQuestionTypeMastery"("childId", "questionTypeId");
CREATE INDEX "StudentQuestionTypeMastery_familyId_childId_status_idx" ON "StudentQuestionTypeMastery"("familyId", "childId", "status");
CREATE INDEX "StudentQuestionTypeMastery_familyId_questionTypeId_idx" ON "StudentQuestionTypeMastery"("familyId", "questionTypeId");

ALTER TABLE "QuestionType" ADD CONSTRAINT "QuestionType_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentQuestionTypeMastery" ADD CONSTRAINT "StudentQuestionTypeMastery_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentQuestionTypeMastery" ADD CONSTRAINT "StudentQuestionTypeMastery_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentQuestionTypeMastery" ADD CONSTRAINT "StudentQuestionTypeMastery_questionTypeId_fkey" FOREIGN KEY ("questionTypeId") REFERENCES "QuestionType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
