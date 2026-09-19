-- 学生档案增加性别，用于首页人物形象区分；历史档案默认男生。
ALTER TABLE "Child" ADD COLUMN "gender" TEXT NOT NULL DEFAULT 'male';
