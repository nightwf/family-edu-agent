ALTER TABLE "User"
ADD COLUMN "wechatOpenId" TEXT,
ADD COLUMN "wechatUnionId" TEXT,
ADD COLUMN "wechatNickname" TEXT,
ADD COLUMN "wechatAvatarUrl" TEXT,
ADD COLUMN "lastWechatLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");
