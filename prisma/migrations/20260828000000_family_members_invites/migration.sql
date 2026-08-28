CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FamilyInvite" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "inviteEmail" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "McpToken" ADD COLUMN "userId" TEXT;
ALTER TABLE "McpToken" ADD COLUMN "familyMemberId" TEXT;
ALTER TABLE "McpToken" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

DELETE FROM "McpToken"
WHERE NOT EXISTS (
  SELECT 1 FROM "Family" WHERE "Family"."id" = "McpToken"."familyId"
);

CREATE UNIQUE INDEX "FamilyMember_familyId_userId_key" ON "FamilyMember"("familyId", "userId");
CREATE UNIQUE INDEX "FamilyInvite_inviteCode_key" ON "FamilyInvite"("inviteCode");
CREATE INDEX "FamilyMember_userId_status_idx" ON "FamilyMember"("userId", "status");
CREATE INDEX "FamilyMember_familyId_role_status_idx" ON "FamilyMember"("familyId", "role", "status");
CREATE INDEX "FamilyInvite_familyId_status_idx" ON "FamilyInvite"("familyId", "status");
CREATE INDEX "FamilyInvite_inviteCode_status_idx" ON "FamilyInvite"("inviteCode", "status");
CREATE INDEX "McpToken_familyId_userId_status_idx" ON "McpToken"("familyId", "userId", "status");
CREATE INDEX "McpToken_familyMemberId_idx" ON "McpToken"("familyMemberId");

ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FamilyMember" ("id", "familyId", "userId", "role", "status", "joinedAt", "createdAt", "updatedAt")
SELECT
  'fm_' || md5("id" || ':' || "familyId"),
  "familyId",
  "id",
  'owner',
  'active',
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("familyId", "userId") DO NOTHING;
