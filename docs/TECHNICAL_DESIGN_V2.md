# 禾芽家庭 AI 私教技术设计文档（V2）

> 文档状态：可进入开发的技术设计基线
> 关联产品文档：`家庭AI私教产品方向需求文档.md`
> 关联架构方案：`ARCHITECTURE_PROPOSAL_V2.md`
> 更新日期：2026-09-05

## 1. 文档范围

本文档定义禾芽家庭 AI 私教第二阶段的技术实现方案，覆盖：

- 运行时组件；
- 目标数据模型；
- REST API 契约；
- MCP 工具契约；
- WorkBuddy 集成规则；
- 后台任务；
- 文件存储；
- 权限安全；
- 部署和迁移；
- 测试与验收。

本文档不包含具体代码，但字段、状态、接口路径、工具名和调用流程必须足够明确，开发时可直接据此实现。

## 2. 产品契约摘要

开发必须遵守以下已确认约束：

- 第一阶段面向 6–12 岁，主要用户是家长；
- 项目不开发独立 AI 对话页面；
- WorkBuddy 负责 AI 对话、讲解、题目生成和计划草案生成；
- 禾芽负责孩子状态、教育方法、家庭边界、数据、计划闭环和报告；
- 一个账号可加入多个家庭；
- 一个家庭可有多个管理者；
- 数据按家庭隔离；
- 教育方法由公共版本库维护，家长只设置边界，不修改公共方法；
- 孩子状态采用分层记录，重要判断每周由家长确认或纠正；
- 第一个 4–8 周主目标由 AI 提案、家长确认；
- 第一阶段先做计划闭环，后接 WorkBuddy 主动规划。

## 3. 系统上下文

```text
Web 家长管理端
微信小程序
        │ HTTPS + JWT
        ▼
Family Education API（Fastify）
   ├── REST API
   ├── MCP HTTP Endpoint
   ├── Domain Services
   └── Agent Gateway
        ▲                    │
        │ Streamable HTTP MCP│ 计划上下文 / 生成请求
        │ X-MCP-Token        ▼
        └────────── WorkBuddy / 豆包工作

PostgreSQL 16      业务事实来源
对象存储           原始文件与附件
Worker             定时任务与异步任务
```

第一阶段仍是单体 API 加独立 Worker，不拆微服务。

## 4. 目标代码结构

建议在现有 monorepo 上重构，不保留根目录旧 JSON 实现。

```text
family-edu-agent/
  apps/
    api/
      src/
        auth/
        family/
        child/
        evidence/
        goal-plan/
        education-method/
        knowledge/
        question-bank/
        wrong-book/
        report/
        mcp/
        jobs/
        storage/
        common/
    web/
      src/
        features/
          family/
          child/
          dashboard/
          plan/
          report/
          settings/
        components/
    miniprogram/
      pages/
  packages/
    contracts/          # 可选：共享 TypeScript 类型
  prisma/
    schema.prisma
    migrations/
  scripts/
  docs/
  docker-compose.yml
```

旧的 `src/api.js`、`src/store.js`、`src/index.js` 和 `data/db.json` 标记为废弃，不在新架构中使用。

## 5. 核心业务流程

### 5.1 家庭与账号

1. 用户使用邮箱密码或微信登录。
2. 注册时如使用家庭邀请码，加入对应家庭；否则创建新家庭。
3. `User` 不再直接绑定唯一 `familyId`，通过 `FamilyMember` 表达“一个账号属于哪些家庭”。
4. 当前登录上下文必须携带 `familyId`，Web 和小程序在切换家庭后重新签发上下文 Token。
5. MCP Token 属于某个家庭，与具体成员可关联，不依赖全局账号猜测。

### 5.2 学生状态

学生状态分为事实、推断和待验证问题：

- 事实自动进入数据库；
- 重要行为推断生成 `EvidenceRecord`，进入周回顾待确认；
- 家长确认、纠正或补充；
- `ChildStateSnapshot` 是由 Worker 根据证据计算出的当前状态，不手工编辑。

### 5.3 目标与周计划

1. 家长请求生成候选目标。
2. 禾芽生成 `PlanningContext`。
3. WorkBuddy 生成 2–3 个 `StageGoal`，状态为 `proposed`。
4. 家长在 Web 或小程序确认、修改或拒绝一个目标。
5. 禾芽生成 `WeeklyPlan` 和 `PlanItem`。
6. 任务完成证据持续写入。
7. 到期后生成 `Assessment`，再产生复盘和下一轮目标。

### 5.4 计划闭环

闭环定义：

> 确认目标 → 生成周计划 → 执行任务 → 记录证据 → 到期复测 → 判断是否改善 → 家长确认下一轮。

只有该闭环稳定后，才接入 WorkBuddy 主动规划。

### 5.5 教材与知识导入

1. WorkBuddy 上传教材文件或材料；
2. 禾芽保存原始文件到对象存储；
3. WorkBuddy 提取章节、知识点、定义、例题、常见错误；
4. 通过 MCP 写回结构化知识节点和关系；
5. Web 和小程序只查看和修正，不承担直接导入。

## 6. 目标数据模型

### 6.1 身份与家庭

```prisma
enum FamilyRole {
  OWNER
  ADMIN
}

enum MemberStatus {
  ACTIVE
  DISABLED
}

model User {
  id                String         @id @default(cuid())
  email             String         @unique
  passwordHash      String?
  wechatOpenId      String?        @unique
  wechatUnionId     String?
  wechatNickname    String?
  wechatAvatarUrl   String?
  lastWechatLoginAt DateTime?
  status            String         @default("active")
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  memberships       FamilyMember[]
  sessions          Session[]
}

model Family {
  id         String         @id @default(cuid())
  name       String
  status     String         @default("active")
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
  members    FamilyMember[]
  invites    FamilyInvite[]
  mcpTokens  McpToken[]
  children   Child[]
  policy     FamilyPolicy?
  goals      StageGoal[]
  plans      WeeklyPlan[]
}

model FamilyMember {
  id        String     @id @default(cuid())
  familyId  String
  family    Family     @relation(fields: [familyId], references: [id], onDelete: Cascade)
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      FamilyRole @default(ADMIN)
  status    MemberStatus @default(ACTIVE)
  joinedAt  DateTime?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@unique([familyId, userId])
  @@index([userId, status])
}

model FamilyInvite {
  id               String     @id @default(cuid())
  familyId         String
  family           Family     @relation(fields: [familyId], references: [id], onDelete: Cascade)
  invitedByUserId  String
  inviteCode       String     @unique
  inviteEmail      String?
  role             FamilyRole @default(ADMIN)
  status           String     @default("pending")
  expiresAt        DateTime
  acceptedByUserId String?
  acceptedAt       DateTime?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  @@index([familyId, status])
  @@index([inviteCode, status])
}

model Session {
  id               String    @id @default(cuid())
  userId           String
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId         String
  refreshTokenHash String
  expiresAt        DateTime
  revokedAt        DateTime?
  createdAt        DateTime  @default(now())

  @@index([userId, familyId])
}

model McpToken {
  id             String        @id @default(cuid())
  familyId       String
  family         Family        @relation(fields: [familyId], references: [id], onDelete: Cascade)
  userId         String?
  familyMemberId String?
  tokenHash      String        @unique
  tokenCipher    String?
  name           String?
  status         String        @default("active")
  lastUsedAt     DateTime?
  createdAt      DateTime      @default(now())
  revokedAt      DateTime?

  @@index([familyId, status])
}
```

### 6.2 孩子与家庭边界

```prisma
enum ChildStatus {
  ACTIVE
  ARCHIVED
}

model Child {
  id             String      @id @default(cuid())
  familyId       String
  family         Family      @relation(fields: [familyId], references: [id], onDelete: Cascade)
  name           String
  birthDate      DateTime?
  grade          String
  subjects       String[]    @default([])
  status         ChildStatus @default(ACTIVE)
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  evidence       EvidenceRecord[]
  goals          StageGoal[]
  plans          WeeklyPlan[]
  knowledgeState ChildKnowledgeState[]
}

model FamilyPolicy {
  id                 String    @id @default(cuid())
  familyId           String    @unique
  family             Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  weeklyTimeBudget   Int?
  prioritySubjects   String[]  @default([])
  pressureBoundary   String?
  parentGoals        String[]  @default([])
  principles         Json?
  version            Int       @default(1)
  effectiveFrom      DateTime  @default(now())
  effectiveTo        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
}

model PolicyChange {
  id         String    @id @default(cuid())
  familyId   String
  type       String
  before     Json?
  after      Json?
  reason     String?
  createdBy  String
  reviewedBy String?
  status     String    @default("proposed")
  createdAt  DateTime  @default(now())
  reviewedAt DateTime?

  @@index([familyId, status])
}
```

### 6.3 教育方法与个性化

```prisma
enum MethodCategory {
  CORE
  SCENARIO
  PHILOSOPHY
}

enum ResourceStatus {
  ACTIVE
  ARCHIVED
  SUPERSEDED
  DRAFT
}

model EducationMethod {
  id             String         @id @default(cuid())
  key            String         @unique
  name           String
  category       MethodCategory
  evidenceLevel  String
  description    String
  applicability  Json?
  risks          Json?
  workflow       Json?
  version        String
  status         ResourceStatus @default(ACTIVE)
  validFrom      DateTime       @default(now())
  validUntil     DateTime?
  supersededBy   String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  effects        MethodEffect[]
}

model MethodEffect {
  id          String    @id @default(cuid())
  familyId    String
  childId     String
  methodId    String
  method      EducationMethod @relation(fields: [methodId], references: [id], onDelete: Cascade)
  goalId      String?
  goal        StageGoal? @relation(fields: [goalId], references: [id], onDelete: SetNull)
  context     Json?
  outcome     String
  confidence  Float?
  evidenceRef String?
  observedAt  DateTime  @default(now())
  createdAt   DateTime  @default(now())

  @@index([familyId, childId, methodId])
  @@index([goalId])
}
```

### 6.4 学生状态与证据

```prisma
enum EvidenceType {
  OBSERVATION
  WRITING
  READING
  HOMEWORK_COMPLETION
  QUESTION_ATTEMPT
  RETEST
  PARENT_NOTE
}

enum ReviewStatus {
  PENDING_CONFIRMATION
  CONFIRMED
  CORRECTED
  SUPERSEDED
}

model EvidenceRecord {
  id                 String       @id @default(cuid())
  familyId           String
  childId            String
  child              Child        @relation(fields: [childId], references: [id], onDelete: Cascade)
  type               EvidenceType
  taskDescription    String?
  environment        String?
  observedBehavior   String?
  frequency          String?
  effectiveStrategy  String?
  counterEvidence    String?
  confidence         Float?
  source             String       @default("workbuddy")
  sourceRef          String?
  observedAt         DateTime     @default(now())
  reviewStatus       ReviewStatus @default(PENDING_CONFIRMATION)
  reviewedAt         DateTime?
  reviewedBy         String?
  createdAt          DateTime     @default(now())

  @@index([familyId, childId, observedAt])
  @@index([familyId, childId, type, reviewStatus])
}

model ChildStateSnapshot {
  id           String   @id @default(cuid())
  familyId     String
  childId      String
  asOf         DateTime
  periodWindow String
  summary      Json?
  indicators   Json?
  confidence   Float?
  sourceVersion String?
  generatedAt  DateTime @default(now())

  @@unique([childId, periodWindow, asOf])
  @@index([familyId, childId, generatedAt])
}
```

### 6.5 目标、周计划与复测

```prisma
enum GoalStatus {
  DRAFT
  PROPOSED
  CONFIRMED
  ACTIVE
  COMPLETED
  CANCELLED
  ARCHIVED
}

enum WeeklyPlanStatus {
  DRAFT
  PROPOSED
  CONFIRMED
  ACTIVE
  COMPLETED
  CANCELLED
}

enum PlanItemType {
  SCHOOL_HOMEWORK
  CHILD_TASK
  PARENT_ACTION
  AGENT_TASK
  RETEST
}

enum PlanItemStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  SKIPPED
  CANCELLED
  NEEDS_REVIEW
}

model StageGoal {
  id             String      @id @default(cuid())
  familyId       String
  family         Family      @relation(fields: [familyId], references: [id], onDelete: Cascade)
  childId        String
  child          Child       @relation(fields: [childId], references: [id], onDelete: Cascade)
  title          String
  objective      String
  criteria       Json?
  startDate      DateTime
  endDate        DateTime
  status         GoalStatus  @default(DRAFT)
  proposedBy     String?
  confirmedBy    String?
  confirmedAt    DateTime?
  methodIds      String[]    @default([])
  contextVersion String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  plans          WeeklyPlan[]
  assessments    Assessment[]
  methodEffects  MethodEffect[]

  @@index([familyId, childId, status])
  @@index([familyId, childId, startDate, endDate])
}

model WeeklyPlan {
  id           String           @id @default(cuid())
  familyId     String
  family       Family           @relation(fields: [familyId], references: [id], onDelete: Cascade)
  childId      String
  child        Child            @relation(fields: [childId], references: [id], onDelete: Cascade)
  stageGoalId  String
  stageGoal    StageGoal        @relation(fields: [stageGoalId], references: [id], onDelete: Cascade)
  weekStart    DateTime
  weekEnd      DateTime
  status       WeeklyPlanStatus @default(DRAFT)
  generatedBy  String?
  confirmedBy  String?
  confirmedAt  DateTime?
  contextVersion String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  items        PlanItem[]

  @@index([familyId, childId, weekStart])
  @@unique([stageGoalId, weekStart])
}

model PlanItem {
  id                 String         @id @default(cuid())
  weeklyPlanId       String
  weeklyPlan         WeeklyPlan     @relation(fields: [weeklyPlanId], references: [id], onDelete: Cascade)
  type               PlanItemType
  title              String
  description        String?
  ownerUserId        String?
  methodId           String?
  sourceRef          String?
  sequence           Int
  estimatedMinutes   Int?
  dueAt              DateTime?
  status             PlanItemStatus @default(PENDING)
  completionEvidence Json?
  completedAt        DateTime?
  createdBy          String?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  @@unique([weeklyPlanId, sequence])
  @@index([weeklyPlanId, status, dueAt])
}

model PlanChange {
  id         String    @id @default(cuid())
  familyId   String
  planId     String?
  planItemId String?
  type       String
  before     Json?
  after      Json?
  reason     String?
  createdBy  String
  approvedBy String?
  status     String    @default("proposed")
  createdAt  DateTime  @default(now())
  reviewedAt DateTime?

  @@index([familyId, status])
}

model Assessment {
  id            String    @id @default(cuid())
  familyId      String
  childId       String
  stageGoalId   String?
  stageGoal     StageGoal? @relation(fields: [stageGoalId], references: [id], onDelete: SetNull)
  planItemId    String?
  title         String
  assessmentType String
  criteria      Json?
  score         Float?
  passed        Boolean?
  outcome       Json?
  sourceRef     String?
  observedAt    DateTime  @default(now())
  createdAt     DateTime  @default(now())

  @@index([familyId, childId, observedAt])
  @@index([stageGoalId])
}
```

### 6.6 知识与教材

```prisma
enum KnowledgeNodeType {
  CHAPTER
  KNOWLEDGE_POINT
  CONCEPT
  EXAMPLE
  MISCONCEPTION
}

enum KnowledgeRelationType {
  PREREQUISITE_OF
  CONTAINS
  RELATED_TO
  EXAMPLE_OF
  ERROR_OF
}

enum ChildKnowledgeStatus {
  UNASSESSED
  LEARNING
  PARTIAL
  MASTERED
  NEEDS_REVIEW
}

model SourceDocument {
  id           String         @id @default(cuid())
  familyId     String
  title        String
  kind         String
  subject      String?
  grade        String?
  publisher    String?
  version      String?
  fileKey      String?
  status       ResourceStatus @default(ACTIVE)
  validFrom    DateTime       @default(now())
  validUntil   DateTime?
  supersededBy String?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  nodes        KnowledgeNode[]

  @@index([familyId, subject, grade, status])
}

model KnowledgeNode {
  id               String            @id @default(cuid())
  familyId         String
  sourceDocumentId String?
  sourceDocument   SourceDocument?   @relation(fields: [sourceDocumentId], references: [id], onDelete: SetNull)
  parentId         String?
  parent           KnowledgeNode?    @relation("KnowledgeTree", fields: [parentId], references: [id], onDelete: SetNull)
  children         KnowledgeNode[]   @relation("KnowledgeTree")
  type             KnowledgeNodeType
  subject          String?
  grade            String?
  title            String
  description      String?
  content          Json?
  sourcePage       String?
  version          String
  status           ResourceStatus    @default(ACTIVE)
  validFrom        DateTime          @default(now())
  validUntil       DateTime?
  supersededBy     String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  outgoingRelations KnowledgeRelation[] @relation("RelationSource")
  incomingRelations KnowledgeRelation[] @relation("RelationTarget")
  childStates       ChildKnowledgeState[]

  @@index([familyId, subject, grade, status])
  @@index([familyId, sourceDocumentId])
}

model KnowledgeRelation {
  id             String                @id @default(cuid())
  familyId       String
  sourceNodeId   String
  sourceNode     KnowledgeNode         @relation("RelationSource", fields: [sourceNodeId], references: [id], onDelete: Cascade)
  targetNodeId   String
  targetNode     KnowledgeNode         @relation("RelationTarget", fields: [targetNodeId], references: [id], onDelete: Cascade)
  relationType   KnowledgeRelationType
  metadata       Json?
  version        String
  validFrom      DateTime              @default(now())
  validUntil     DateTime?
  createdAt      DateTime              @default(now())

  @@index([familyId, sourceNodeId, relationType])
  @@index([familyId, targetNodeId, relationType])
}

model ChildKnowledgeState {
  id             String               @id @default(cuid())
  familyId       String
  childId        String
  child          Child                @relation(fields: [childId], references: [id], onDelete: Cascade)
  knowledgeNodeId String
  knowledgeNode  KnowledgeNode        @relation(fields: [knowledgeNodeId], references: [id], onDelete: Cascade)
  status         ChildKnowledgeStatus @default(UNASSESSED)
  score          Float                @default(0)
  evidence       Json?
  lastPracticedAt DateTime?
  nextReviewAt   DateTime?
  manualStatus   String?
  manualReason   String?
  manualSource   String?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  @@unique([childId, knowledgeNodeId])
  @@index([familyId, childId, status])
  @@index([knowledgeNodeId, status])
}
```

### 6.7 周回顾、阶段报告与后台任务

```prisma
model WeeklyReview {
  id               String    @id @default(cuid())
  familyId         String
  childId          String
  weekStart        DateTime
  weekEnd          DateTime
  status           String    @default("draft")
  draft            Json?
  parentAdjustments Json?
  confirmedAt      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([childId, weekStart])
  @@index([familyId, childId, status])
}

model StageReport {
  id             String    @id @default(cuid())
  familyId       String
  childId        String
  stageGoalId    String?
  periodStart    DateTime
  periodEnd      DateTime
  verdict        String?
  summary        String?
  evidence       Json?
  nextRecommendations Json?
  status         String    @default("draft")
  generatedAt    DateTime  @default(now())
  createdAt      DateTime  @default(now())

  @@index([familyId, childId, generatedAt])
  @@index([stageGoalId])
}

model BackgroundJob {
  id          String    @id @default(cuid())
  familyId    String?
  type        String
  status      String    @default("pending")
  payload     Json?
  nextRunAt   DateTime?
  lockedAt    DateTime?
  attempts    Int       @default(0)
  lastError   String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([type, status, nextRunAt])
}

model StoredObject {
  id              String    @id @default(cuid())
  familyId        String
  bucket          String
  objectKey       String
  contentType     String?
  size            Int?
  checksum        String?
  retentionPolicy String?
  status          String    @default("active")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([familyId, status])
}

model AuditLog {
  id         String    @id @default(cuid())
  familyId   String?
  actorType  String
  actorId    String?
  action     String
  entityType String
  entityId   String?
  before     Json?
  after      Json?
  reason     String?
  metadata   Json?
  createdAt  DateTime  @default(now())

  @@index([familyId, createdAt])
  @@index([entityType, entityId])
}
```

### 6.8 现有资源模型的调整

以下现有表继续保留，但按新领域调整：

| 模型 | 保留 | 需要调整 |
| --- | --- | --- |
| `QuestionType` | 是 | 增加 `validFrom`、`validUntil`、`supersededBy`、`sourceDocumentId`、`knowledgeNodeId` |
| `Question` | 是 | 增加 `planItemId?`、`sourceDocumentId?`、`knowledgeNodeId?`、`validFrom`、`validUntil` |
| `QuestionAttempt` | 是 | 增加 `assessmentId?`、`planItemId?`，保持学生作答证据语义 |
| `StudentQuestionTypeMastery` | 是 | 保留自动/人工状态，增加 `evidenceVersion` 和重算时间 |
| `WrongQuestionEntry` | 是 | 增加 `planItemId?`、`knowledgeNodeId?` |
| `PracticePaper` | 是 | 增加 `planItemId?` |
| `RemediationPlan` | 是 | 增加 `stageGoalId?`、`weeklyPlanId?`，但不再作为唯一周计划 |
| `Homework` | 是 | 增加 `planItemId?`、`sourceDocumentId?` |

### 6.9 废弃或替代的模型

- `Family.educationPhilosophy`、`communicationStyle`、`strictness`、`parentGoals`：由 `FamilyPolicy` 替代。
- `FamilySkillProfile` 与 `SkillOverride`：由 `FamilyPolicy`、`EducationMethod`、`MethodEffect` 和 `PolicyChange` 替代。
- `Record`、`Report`、`KnowledgeItem`：由 `EvidenceRecord`、`WeeklyReview`、`StageReport`、`SourceDocument`、`KnowledgeNode` 替代。
- `Textbook`：由 `SourceDocument` 替代，不再强制绑定 `childId`。

旧表可以保留为只读迁移源，但不参与新业务读写。

## 7. 领域不变量

开发时必须强制以下规则：

### 7.1 家庭隔离

- Web 和小程序从登录上下文获取 `familyId`；
- MCP 从 `X-MCP-Token` 获取 `familyId`；
- 不接受调用方传入的 `familyId` 作为可信来源；
- 所有 `childId`、`goalId`、`planId`、`questionId`、`knowledgeNodeId` 等写入前再次校验属于当前家庭。

### 7.2 账号与家庭

- `User` 不绑定唯一家庭；
- `FamilyMember` 是账号与家庭关系的唯一来源；
- 一个家庭至少保留一个 `OWNER`；
- 删除或停用成员不能删除家庭共同数据。

### 7.3 知识与版本

- 默认查询只返回 `status=active` 且当前时间在有效期内；
- 新版本替代旧版本时旧版本改为 `superseded`，不删除；
- 计划或报告引用知识时固定版本号；
- 后续版本更新不得改写历史计划引用。

### 7.4 学生状态

- 当前状态由 `EvidenceRecord` 计算，不直接编辑；
- 历史观察没有新证据时降级为历史模式；
- 重要推断必须经过 `pending_confirmation → confirmed/corrected`；
- 家长可以纠正，但修改历史必须写 `AuditLog`。

### 7.5 掌握度

- 单次正确不能标记已掌握；
- 自动状态和人工状态分开保存；
- 人工修正必须填写原因和来源；
- 重算不覆盖人工结论，除非家长主动清除人工修正。

### 7.6 删除

- 有关联证据的题目、题型、错题、教材和计划只能归档或停用；
- 删除孩子档案必须显式确认，并归档关联证据；
- 账号注销不等于直接删除家庭共享数据。

## 8. REST API 契约

除现有资源接口外，新增以下核心接口。

### 8.1 家庭

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/family` | 获取当前家庭和当前成员身份 |
| `GET` | `/api/family/members` | 获取成员列表 |
| `POST` | `/api/family/invites` | 创建家庭邀请码 |
| `POST` | `/api/family/invites/accept` | 接受邀请 |
| `DELETE` | `/api/family/members/:memberId` | 移除成员 |
| `GET` | `/api/family/policy` | 获取当前家庭边界 |
| `PUT` | `/api/family/policy` | 更新家庭边界，写 `PolicyChange` |

### 8.2 孩子与状态

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/children` | 获取当前家庭孩子 |
| `POST` | `/api/children` | 创建孩子 |
| `PATCH` | `/api/children/:childId` | 更新孩子 |
| `DELETE` | `/api/children/:childId` | 归档或删除孩子 |
| `GET` | `/api/children/:childId/state` | 获取当前状态快照 |
| `GET` | `/api/children/:childId/evidence` | 分页获取证据 |
| `POST` | `/api/children/:childId/evidence` | 写入证据 |
| `PATCH` | `/api/evidence/:evidenceId/review` | 家长确认或纠正推断 |

### 8.3 目标与计划

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/children/:childId/goals/generate` | 发起候选目标生成 |
| `GET` | `/api/children/:childId/goals` | 获取目标 |
| `GET` | `/api/goals/:goalId` | 获取目标详情 |
| `PATCH` | `/api/goals/:goalId` | 确认、修改、取消目标 |
| `GET` | `/api/children/:childId/plans` | 获取周计划 |
| `GET` | `/api/plans/:planId` | 获取周计划详情 |
| `PATCH` | `/api/plans/:planId` | 确认或调整计划 |
| `PATCH` | `/api/plan-items/:itemId/status` | 更新任务状态和证据 |
| `POST` | `/api/goals/:goalId/assessments` | 写入复测 |

### 8.4 知识与教材

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/source-documents` | 获取家庭教材/来源 |
| `GET` | `/api/source-documents/:sourceId` | 获取来源详情 |
| `PATCH` | `/api/source-documents/:sourceId` | 修正来源元数据或版本 |
| `GET` | `/api/knowledge-nodes` | 获取知识节点 |
| `GET` | `/api/knowledge-nodes/:nodeId` | 获取知识节点详情 |
| `GET` | `/api/children/:childId/knowledge-state` | 获取孩子知识掌握状态 |
| `POST` | `/api/knowledge-nodes/import` | 批量导入结构化知识 |

### 8.5 教育与报告

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/education-methods` | 获取公共方法库 |
| `GET` | `/api/children/:childId/method-effects` | 获取方法效果 |
| `GET` | `/api/children/:childId/weekly-reviews` | 获取周回顾 |
| `POST` | `/api/children/:childId/weekly-reviews` | 提交或确认周回顾 |
| `GET` | `/api/children/:childId/stage-reports` | 获取阶段报告 |

### 8.6 通用约定

- 所有列表接口支持 `limit`、`offset`，默认 20，最大 100；
- 错误返回 `{ error: string, code?: string }`；
- 所有写操作在成功后返回写入后的资源；
- 所有危险删除使用 `DELETE` 或 `POST /archive`，并需要二次确认参数。

## 9. MCP 工具契约

### 9.1 新增核心工具

| 工具名 | 用途 | 输入关键字段 |
| --- | --- | --- |
| `get_agent_bootstrap` | 新会话读取家庭、孩子和能力路由 | 无 |
| `get_sync_spec` | 读取同步规范 | 无 |
| `get_family_policy` | 读取家庭边界 | 无 |
| `update_family_policy` | 更新家庭边界 | `time_budget`、`priorities`、`boundaries` |
| `propose_policy_change` | WorkBuddy 提出边界变化，家长确认 | `type`、`reason`、`after` |
| `review_policy_change` | 家长确认或忽略边界变化 | `change_id`、`action` |
| `list_education_methods` | 读取公共方法库 | `category`、`subject`、`grade` |
| `get_education_method` | 读取方法定义和风险 | `method_id` |
| `save_method_effect` | 记录方法在孩子身上的效果 | `child_id`、`method_id`、`outcome`、`confidence` |
| `get_child_state` | 读取孩子当前状态 | `child_id` |
| `save_evidence_record` | 写入结构化证据 | `child_id`、`type`、`observed_behavior`、`source_ref` |
| `review_evidence_record` | 家长确认或纠正证据 | `evidence_id`、`action`、`note` |
| `get_planning_context` | 读取生成目标所需上下文 | `child_id`、`purpose` |
| `propose_stage_goals` | WorkBuddy 写回 2–3 个候选目标 | `child_id`、`goals[]` |
| `list_stage_goals` | 获取阶段目标 | `child_id`、`status` |
| `get_stage_goal` | 获取目标详情 | `goal_id` |
| `confirm_stage_goal` | 家长确认、修改或拒绝目标 | `goal_id`、`action`、`changes` |
| `create_weekly_plan` | WorkBuddy 生成周计划 | `goal_id`、`week_start`、`items[]` |
| `list_weekly_plans` | 获取周计划 | `child_id`、`week_start` |
| `get_weekly_plan` | 获取计划详情 | `plan_id` |
| `update_plan_item_status` | 更新任务状态和证据 | `item_id`、`status`、`evidence` |
| `import_source_document` | 保存教材或来源文件及结构化知识 | `title`、`subject`、`grade`、`file_ref`、`nodes[]` |
| `list_source_documents` | 获取家庭来源 | `subject`、`grade`、`status` |
| `get_knowledge_context` | 获取某知识点的上下文包 | `child_id`、`knowledge_node_id` |
| `save_knowledge_nodes_batch` | 批量写回结构化知识 | `source_document_id`、`nodes[]` |
| `get_weekly_review_draft` | 获取周回顾草稿 | `child_id`、`week_start` |
| `confirm_weekly_review` | 家长确认周回顾 | `review_id`、`adjustments` |

### 9.2 保留现有工具

现有孩子、题库、错题、作业、报告、教材、教育 Skill 工具继续保留，但需要：

- `get_child_context` 改为返回当前状态快照、当前目标和最近证据；
- `save_learning_record` 内部写入 `EvidenceRecord`；
- `create_report` 改为生成 `WeeklyReview` 或 `StageReport`；
- `import_textbook` 改为写入 `SourceDocument` 和 `KnowledgeNode`；
- 旧的 `FamilySkillProfile` 相关工具改为映射到 `FamilyPolicy` 和 `EducationMethod`。

### 9.3 规划上下文结构

`get_planning_context` 必须返回：

```json
{
  "child": {
    "child_id": "string",
    "name": "string",
    "grade": "string",
    "subjects": ["string"]
  },
  "current_goal": null,
  "current_state": {},
  "recent_evidence": [],
  "knowledge_gaps": [],
  "active_methods": [],
  "family_policy": {},
  "generation_requirements": {
    "goal_count": 3,
    "goal_horizon_weeks": 6,
    "required_fields": ["title", "objective", "criteria", "start_date", "end_date"]
  }
}
```

## 10. WorkBuddy 同步规范

新 WorkBuddy 规范必须写入：

- 先调用 `get_agent_bootstrap`；
- 涉及孩子先确认 `child_id`；
- 制定阶段目标前必须调用 `get_planning_context`；
- 候选目标通过 `propose_stage_goals` 写回，不直接创建已确认目标；
- 生成周计划前必须读取已确认目标；
- 每次行为推断通过 `save_evidence_record`，不得写入自由文本报告替代；
- 普通闲聊不保存；
- 写入后必须读取结果确认；
- 不得根据单次正确宣布掌握；
- 更新计划任务必须通过 `update_plan_item_status`；
- 教材和知识必须先保存来源，再保存知识节点。

## 11. 后台任务

### 11.1 任务类型

| 任务 | 触发时间 | 行为 |
| --- | --- | --- |
| `refresh_child_state` | 每日或证据写入后 | 根据最近 7 天、4–8 周证据生成状态快照 |
| `generate_weekly_review` | 每周结束 | 生成周回顾草稿 |
| `generate_stage_report` | 阶段目标到期 | 生成阶段报告草稿 |
| `due_review_reminder` | 复测或任务到期 | 生成提醒任务 |
| `expire_knowledge` | 每日 | 把超过有效期的知识标记为过期或需复核 |
| `sync_workbuddy_task` | 后续启用 | 调用 WorkBuddy 云端任务并接收结果 |

### 11.2 实现方式

第一阶段使用数据库 `BackgroundJob` 表加 Worker 定时扫描。Worker 是独立进程，与 API 共用数据库。

不要求第一阶段引入 Redis 或 BullMQ。

## 12. 文件存储

- 原始教材、题目图片、孩子语音或图片证据存对象存储；
- 对象键使用 `{familyId}/{kind}/{objectId}/{version}`；
- PostgreSQL 的 `StoredObject` 保存对象键、类型、校验和和保留策略；
- 临时文件提取为文本或结构化数据后，按家庭隐私策略决定是否保留；
- 删除原始文件前必须确认没有活动知识节点或证据引用。

## 13. 安全与权限

- Web 和小程序使用短期 JWT 加刷新 Token；
- MCP 使用 `X-MCP-Token`，Token 只保存哈希；
- Token 必须可在设置页单独吊销，不影响账号登录；
- 所有跨家庭访问返回 404 或 403，不泄露资源是否存在；
- 敏感修改写入 `AuditLog`；
- 微信 `openid`、`unionid` 和家庭 Token 不进入前端日志；
- 未成年人数据删除、导出和保留策略在设置页可见。

## 14. 部署

### 14.1 容器

- `api`：Fastify；
- `worker`：独立 Node 进程；
- `db`：PostgreSQL 16；
- `minio` 或腾讯云 COS：对象存储；
- Nginx 只代理 `/family-edu/`。

### 14.2 关键环境变量

```text
DATABASE_URL
JWT_SECRET
INVITE_CODES
WECHAT_APP_ID
WECHAT_APP_SECRET
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
S3_BUCKET
S3_USE_SSL
WORKBUDDY_MCP_URL
WORKBUDDY_CLOUD_TASK_ENABLED
```

## 15. 迁移策略

### 15.1 必须保留

- 用户账号；
- 家庭；
- 家庭成员关系；
- 孩子基础档案。

### 15.2 迁移步骤

1. 备份 PostgreSQL；
2. 创建新表；
3. 将 `User.familyId` 回填为 `FamilyMember`；
4. 将家庭教育字段回填为 `FamilyPolicy`；
5. 将旧的 `Record` 作为 `EvidenceRecord` 历史数据导入，标记为历史来源；
6. 旧 `Report`、`KnowledgeItem` 只读归档，不自动转换为新报告；
7. 迁移成功后停止旧 JSON 服务，删除或封存 `data/db.json` 和根目录旧代码；
8. 迁移失败时回滚，不直接删除旧表。

## 16. 测试与验收

### 16.1 测试范围

- 领域服务单元测试：目标状态机、证据确认、掌握度、版本有效性；
- API 测试：登录、家庭隔离、资源归属、分页；
- MCP smoke test：`get_agent_bootstrap`、`get_planning_context`、`propose_stage_goals`；
- Web E2E：目标确认、周计划展示、报告打开；
- 小程序测试：登录、学生切换、计划状态更新；
- 迁移测试：旧账号、家庭和孩子可正常登录和访问；
- 性能测试：列表接口分页不超过 100，首屏请求不携带全量历史。

### 16.2 核心验收

1. 一个账号可加入多个家庭，并在切换家庭后看到正确数据。
2. 家庭多个管理者共享同一家庭数据。
3. AI 可生成候选目标，家长确认后形成周计划。
4. 计划任务完成后产生证据，到期复测能更新孩子状态。
5. 教材导入后生成可追溯知识节点，旧版本不影响新计划。
6. 单次答对不会标记已掌握。
7. WorkBuddy 只收到当前上下文，不收到全量历史。
8. 未授权家庭无法访问其他家庭资源。
9. Web 和手机端列表均使用分页。
10. 旧账号、家庭和孩子迁移后可正常使用。

## 17. 实施顺序

### Phase 0：数据基线

- 更新 Prisma schema；
- 执行迁移与回填；
- 移除旧 JSON 运行路径。

### Phase 1：身份与家庭边界

- 多家庭账号；
- 家庭成员；
- `FamilyPolicy`；
- 权限与 Token 吊销。

### Phase 2：证据与学生状态

- `EvidenceRecord`；
- 证据确认；
- `ChildStateSnapshot`；
- 当前状态计算。

### Phase 3：目标与周计划

- `StageGoal`、`WeeklyPlan`、`PlanItem`；
- 候选目标流程；
- 家长确认；
- 任务状态与复测。

### Phase 4：知识与教材

- `SourceDocument`；
- `KnowledgeNode`；
- 知识关系；
- `ChildKnowledgeState`。

### Phase 5：MCP 与 WorkBuddy

- 新增 MCP 工具；
- 更新启动规范；
- 更新开放平台包。

### Phase 6：报告与 Worker

- 周回顾；
- 阶段报告；
- 定时任务；
- 提醒。

### Phase 7：前端重组

- Web 以孩子为中心重构；
- 小程序按新导航调整；
- 资源功能下沉。

### Phase 8：部署验证

- Docker 部署；
- Nginx 路径验证；
- Web、小程序、MCP smoke test；
- 提交并推送 GitHub。
