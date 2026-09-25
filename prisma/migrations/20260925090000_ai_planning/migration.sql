ALTER TABLE "PlanningRequest"
  ADD COLUMN "weeklyPlanId" TEXT,
  ADD COLUMN "aiDraft" JSONB,
  ADD COLUMN "generatedAt" TIMESTAMP(3),
  ADD COLUMN "generationError" TEXT;

CREATE INDEX "PlanningRequest_familyId_childId_generatedAt_idx"
  ON "PlanningRequest"("familyId", "childId", "generatedAt");
