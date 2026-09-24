-- 内置学习私教（Education Agent Layer）：会话、消息、内容安全事件三张表。
-- 纯新增，不改动任何现有表与数据。childId 为空表示家庭级会话。

-- CreateTable
CREATE TABLE "TutorConversation" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT,
    "userId" TEXT,
    "persona" TEXT NOT NULL DEFAULT 'child_tutor',
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "summarizedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "contentJson" JSONB,
    "attachments" JSONB,
    "toolCalls" JSONB,
    "moderationStatus" TEXT NOT NULL DEFAULT 'passed',
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorSafetyEvent" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "childId" TEXT,
    "conversationId" TEXT,
    "stage" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "excerpt" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorSafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TutorConversation_familyId_childId_lastMessageAt_idx" ON "TutorConversation"("familyId", "childId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "TutorConversation_familyId_status_lastMessageAt_idx" ON "TutorConversation"("familyId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "TutorMessage_conversationId_createdAt_idx" ON "TutorMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "TutorMessage_familyId_childId_createdAt_idx" ON "TutorMessage"("familyId", "childId", "createdAt");

-- CreateIndex
CREATE INDEX "TutorSafetyEvent_familyId_createdAt_idx" ON "TutorSafetyEvent"("familyId", "createdAt");

-- AddForeignKey
ALTER TABLE "TutorConversation" ADD CONSTRAINT "TutorConversation_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorConversation" ADD CONSTRAINT "TutorConversation_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMessage" ADD CONSTRAINT "TutorMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "TutorConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorSafetyEvent" ADD CONSTRAINT "TutorSafetyEvent_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
