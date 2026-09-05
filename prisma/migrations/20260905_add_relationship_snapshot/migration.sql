-- CreateTable
CREATE TABLE "ChildRelationshipSnapshot" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'stable',
    "score" DOUBLE PRECISION,
    "communicationNote" TEXT,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "parentAction" TEXT,
    "evidence" JSONB,
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildRelationshipSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildRelationshipSnapshot_familyId_childId_generatedAt_idx" ON "ChildRelationshipSnapshot"("familyId", "childId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChildRelationshipSnapshot_childId_asOf_key" ON "ChildRelationshipSnapshot"("childId", "asOf");

