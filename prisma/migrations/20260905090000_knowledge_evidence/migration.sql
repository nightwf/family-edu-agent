ALTER TABLE "KnowledgeNode"
ADD COLUMN "evidence" JSONB,
ADD COLUMN "assessmentPrompt" TEXT,
ADD COLUMN "commonErrors" JSONB;

ALTER TABLE "KnowledgeRelation"
ADD COLUMN "strength" TEXT,
ADD COLUMN "reason" TEXT;
