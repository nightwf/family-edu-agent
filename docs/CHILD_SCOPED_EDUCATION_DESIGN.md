# 教育方式按孩子维度分层（Child-Scoped Education）

> 状态：设计稿，待确认后统一开发。
> 本文只描述"教育方式/策略按孩子维度分层"这一件事，不涉及内置对话私教（见 `TUTOR_AGENT_DESIGN.md`）、不涉及技能文件化改造（见本文 12.2）。
> 撰写日期：2026-09-24。

## 1. 文档范围

**要解决的唯一问题**：同一个家庭的两个孩子，现在必然共用一套教育方式。系统需要支持"这个孩子这样带，那个孩子那样带"，同时家庭级仍然作为默认与兜底。

**明确不在本文范围**：

| 事项 | 归属 |
|---|---|
| 内置对话私教（Education Agent Layer） | `TUTOR_AGENT_DESIGN.md` |
| 技能从文件改为数据库真源（"改一条要发版"） | 本文 12.2 仅登记，不在本次实施 |
| 旧·字符串匹配式教育方法推荐仍在服务中（`ARCHITECTURE_PROPOSAL_V2.md` 1.3） | 独立收敛项，不阻断本文实施 |
| 教育理念库本身要不要内置、要不要让家长选 | 另立专题，本文只用现有理念取值 |

## 2. 结论先行

1. **解析顺序固定为三层，逐字段回落**：全局基础技能 → 家庭策略 → 孩子级调整。孩子级不是替代家庭级，而是在家庭级之上做覆盖。
2. **新增一张可选表 `ChildSkillProfile`**（`@@unique([childId, skillId])`），不把 `childId` 塞进现有 `FamilySkillProfile`。
3. **纯新增迁移，不需要数据迁移**。既有家庭和孩子不需要任何回填，自动表现为"继承家庭设置"。
4. **不传 `child_id` 时，行为与今天完全一致**。这是对 WorkBuddy 的硬承诺：现有 `get_effective_skill` 调用方零改动、零回归。
5. **家庭边界（时间预算、压力边界）本次保持家庭级**，孩子级只管教育方式（理念、沟通风格、严格程度、家长目标、学习特点）。理由见 13.1。
6. **不新造审批流**。写入复用现有 `PolicyChange` 留痕，`childId` 作为新增维度字段。

## 3. 现状核实（2026-09-24）

### 3.1 数据层

| 模型 | 维度 | 位置 |
|---|---|---|
| `FamilyPolicy` | `familyId String @unique`，一家一条 | `prisma/schema.prisma` |
| `FamilySkillProfile` | `@@unique([familyId, skillId])` | `prisma/schema.prisma` |
| `SkillOverride` | 挂在 `FamilySkillProfile` 上，家庭级 | `prisma/schema.prisma` |
| `Child` | 只有 `name / gender / age / grade / subjects / textbookVersion / status`，**没有任何风格或偏好字段** | `prisma/schema.prisma` |

结论：**数据结构上不存在承载"孩子个体教育方式"的位置**，因此两个孩子必然同配置。

### 3.2 解析与出口链路

```
apps/api/src/personalization.ts:99   getEffectiveSkill(familyId, skillId)
        │
        ├── getFamilyProfile(familyId, skillId)            personalization.ts:46
        ├── prisma.family（family 级 educationPhilosophy / communicationStyle / strictness）
        └── recommendEducationMethods(...)                 personalization.ts:116
        │
        ▼
┌───────────────────────────────┬────────────────────────────────────┐
│ MCP  get_effective_skill       │ REST GET /api/policies/:skillId/effective │
│ apps/api/src/mcp.ts:222        │ apps/api/src/app.ts:1086                  │
└───────────────────────────────┴────────────────────────────────────┘
```

同源的其余出口：

| 出口 | 位置 | 现状 |
|---|---|---|
| `list_family_policies` | `apps/api/src/mcp.ts:218` | 只返回家庭级 |
| `update_family_policy` | `apps/api/src/mcp.ts:230` | 只写家庭级 |
| `GET /api/policies` | `apps/api/src/app.ts:1082` | 只返回家庭级 |
| `PATCH /api/policies/:skillId` | `apps/api/src/app.ts:1093` | 只写家庭级 |
| `GET / PATCH /api/education-settings` | `apps/api/src/app.ts:1108 / 1112` | 只读写 `Family` 表字段 |
| `GET /api/education-methods` | `apps/api/src/app.ts:1122` | 只按家庭设置推荐 |

### 3.3 前端入口现状

| 端 | 现状 |
|---|---|
| 微信小程序 | `miniprogram/pages/settings-detail/` 是**唯一**的教育理念设置入口（理念、沟通风格、严格程度、家长目标），全部按家庭级保存 |
| 网页端 | `apps/web/src/App.tsx` 中 `saveEducationSettings` **仅有定义、无渲染使用**（全文件出现 1 次），即网页端目前没有教育理念表单 |
| 家长可感知的缺口 | 小程序「我的 → 家庭教育方式」改一次，全家所有孩子一起变 |

### 3.4 隔离守则现状

`assertChildInFamily` 在四个模块各写了一份**未导出**的局部实现，形状完全一致：

```
apps/api/src/v2/evidence.ts:20
apps/api/src/v2/goal-plan.ts:8
apps/api/src/v2/relationship.ts:4
apps/api/src/v2/reports.ts:4
```

本次改动会新增第五个使用点（孩子级教育方式读写），因此顺带把守卫收敛为一处，见第 10 节。

## 4. 设计原则

1. **家庭是默认，孩子是例外。** 孩子级配置是"覆盖"，不是"副本"。家庭改一次，没有单独设置的孩子跟着变。
2. **逐字段回落，不做整块覆盖。** 孩子只设了"严格程度"，理念和沟通风格仍然来自家庭；不会因为开通了孩子级就丢掉家庭设置。
3. **一切可追溯。** 每次写入都落一条 `PolicyChange`，带 `familyId`、`childId`、`skillId`、`createdBy`，可回答"这个孩子这套方式是何时、被谁改的"。
4. **家庭隔离永远优先。** 任何接受 `childId` 的读写都要先确认该孩子属于当前家庭，不信任调用方传入的 id。
5. **向后兼容是硬约束。** 不带 `child_id` 的调用，返回值与今天逐字段一致；新增字段只做加法。
6. **不另建一套机制。** 复用现有 `PolicyChange`、family-scoped 的 MCP 身份解析与 REST 鉴权，不引入第二套审批或第二份技能表。

## 5. 概念模型：三层解析

```
① 全局基础技能        skills/*.md（版本化，所有家庭共用）
      ↓ 被覆盖
② 家庭策略            FamilySkillProfile / Family（一家一套，默认值来源）
      ↓ 被覆盖
③ 孩子级调整          ChildSkillProfile（可选，默认空）
      ↓
   最终生效设置 effective skill
```

### 5.1 字段级解析规则

| 字段 | 孩子级取值 | 家庭级取值 | 兜底默认 |
|---|---|---|---|
| `philosophy` 教育理念 | `ChildSkillProfile.philosophy` | `FamilySkillProfile.philosophy` → `Family.educationPhilosophy` | `以引导和鼓励为主` |
| `communicationStyle` 沟通风格 | `ChildSkillProfile.communicationStyle` | `FamilySkillProfile.communicationStyle` → `Family.communicationStyle` | `温和直接` |
| `strictness` 严格程度 | `ChildSkillProfile.strictness` | `FamilySkillProfile.strictness` → `Family.strictness` | `适中` |
| `parentGoals` 家长目标 | `ChildSkillProfile.parentGoals`（非空才生效） | `FamilySkillProfile.parentGoals` | `[]` |
| `notes` 学习特点 | `ChildSkillProfile.notes` | 无家庭级对应 | `null` |

规则要点：

- 孩子级字段为 `null` / 空数组 → **逐项**回落到家庭级，不是整体失效。
- `active = false` 的孩子级配置视为不存在（保留记录但暂不生效）。
- `notes`（学习特点）只有孩子级有，它描述的是"这个孩子怎么学"，不属于家庭共性。

### 5.2 生效来源标记

解析结果附带 `resolution`，让前端和智能体都能一眼看出这套设置从哪来：

| `resolution` | 含义 |
|---|---|
| `child` | 存在生效中的孩子级配置 |
| `family` | 没有孩子级配置，但有家庭级设置（无论来自 `Family` 表还是 `FamilySkillProfile`） |
| `default` | 家庭和孩子的都没设过，全部走兜底默认值 |

另附 `child_overrides: string[]`，列出这个孩子实际覆盖了哪几个字段（`philosophy` / `communicationStyle` / `strictness` / `parentGoals`）。前端用它显示"已单独设置 3 项"，智能体用它判断"哪些是这个孩子的特殊要求"。

### 5.3 构建给模型的内容

`effective_content` 由三段拼接：

```
【基础技能正文】
【家庭个性化配置】        ← 家庭级（理念 / 沟通 / 严格 / 家庭目标）
【孩子个体差异配置】      ← 仅当存在孩子级配置时追加
   孩子：JOJO
   教育理念：自主探索
   沟通风格：鼓励为主      ← 未单独设置，继承自家庭
   严格程度：严格
   家长目标：每天写一段
   孩子学习特点：写字慢，需要先口述再动笔
   说明：本节是针对这个孩子的调整；与家庭配置不一致时，以本节为准。
```

没有孩子级配置时**不出现第三段**，保证不传 `child_id` 的既有输出长度与结构不变。

## 6. 数据模型

### 6.1 新增 `ChildSkillProfile`

```prisma
// 教育方式按孩子维度分层：孩子级配置覆盖家庭级配置，未配置时自动继承家庭设置。
model ChildSkillProfile {
  id                 String   @id @default(cuid())
  childId            String
  child              Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  familyId           String
  skillId            String
  baseVersion        String   @default("1.0.0")
  active             Boolean  @default(true)
  philosophy         String?
  communicationStyle String?
  strictness         String?
  parentGoals        String[]
  notes              String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([childId, skillId])
  @@index([familyId, skillId])
}
```

`Child` 侧增加反向关系 `skillProfiles ChildSkillProfile[]`。

字段设计说明：

- `familyId` 冗余存储，用于按家庭批量查询与审计；**它不是过滤条件**，所有读写仍然先校验 `childId` 归属。
- 保留 `baseVersion` 与 `FamilySkillProfile` 对齐，为将来技能版本化留口子（本次不使用）。
- 不加 `overrides` 关系：逐条覆盖（`SkillOverride`）本次只保留家庭级，孩子级用字段覆盖已经够用；等真实出现"某孩子要改技能正文某一句话"的需求再补，避免现在过度建模。

### 6.2 `PolicyChange` 增加孩子维度

```prisma
model PolicyChange {
  // ...既有字段不变
  childId    String?
  @@index([familyId, childId])
}
```

用途：区分"家庭级变更"与"某个孩子的变更"，让 `/api/policy-changes` 能够按孩子筛选，也让审计能回答"谁改了这个孩子"。

### 6.3 迁移

新增迁移目录 `prisma/migrations/20260924090000_child_skill_profile/migration.sql`（命名对齐现有 `20260919010000_child_gender` 等），内容为纯新增：

```sql
CREATE TABLE "ChildSkillProfile" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "baseVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "philosophy" TEXT,
    "communicationStyle" TEXT,
    "strictness" TEXT,
    "parentGoals" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChildSkillProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChildSkillProfile_childId_skillId_key" ON "ChildSkillProfile"("childId", "skillId");
CREATE INDEX "ChildSkillProfile_familyId_skillId_idx" ON "ChildSkillProfile"("familyId", "skillId");

ALTER TABLE "ChildSkillProfile"
    ADD CONSTRAINT "ChildSkillProfile_childId_fkey"
    FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyChange" ADD COLUMN "childId" TEXT;
CREATE INDEX "PolicyChange_familyId_childId_idx" ON "PolicyChange"("familyId", "childId");
```

**迁移性质与数据影响**：

- 只有 `CREATE TABLE` / `ADD COLUMN` / 建索引，**没有 `DROP`、没有 `UPDATE`、没有 `NOT NULL` 回填**。
- 存量账号、孩子、报告、题库、错题、作业、教材、知识库**一条都不动**。
- 迁移完成后，所有既有家庭天然处于"没有孩子级配置"的状态，解析结果与改造前一致。
- 回滚：删表、删列即可，不影响其他表。

### 6.4 为什么不采用另外两种做法

| 备选 | 否决理由 |
|---|---|
| 把 `childId` 加进 `FamilySkillProfile` 并改为可空 | 需要给存量行回填、要改唯一键、并把"家庭级"和"孩子级"混进一张表，让每次查询都要区分两种语义；解析逻辑和审计都会变复杂 |
| 在 `Child` 上加 `educationProfile Json` | 无法建索引与约束、无法按 `skillId` 维度查询、`PolicyChange` 的 before/after 也就失去可比对的字段结构；与现有 `FamilySkillProfile` 不对称 |

## 7. 接口契约

### 7.1 REST（家长端，JWT 鉴权）

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/children/:childId/education-profile` | 读取该孩子每个教育 Skill 的个体配置 + 合并后的最终设置 |
| `PATCH` | `/api/children/:childId/education-profile` | 写入该孩子的个体配置；`clear: true` 时清空回复继承 |
| `GET` | `/api/policies?child_id=` | 读取家庭级配置；带 `child_id` 时附带该孩子的个体配置 |
| `GET` | `/api/policies/:skillId/effective?child_id=` | 读取最终生效技能；带 `child_id` 时应用孩子级覆盖 |
| `PATCH` | `/api/policies/:skillId` | 带 `child_id` 写孩子级，不带写家庭级（同一入口两个语义，参数显式区分） |

`GET /api/children/:childId/education-profile` 返回形状：

```json
[
  {
    "skill_id": "writing-coach",
    "name": "写作教练",
    "child_id": "child_xxx",
    "child_name": "JOJO",
    "profile": { "philosophy": "自主探索", "notes": "写字慢，先口述再动笔" },
    "inherited_from_family": { "philosophy": "习惯优先", "communicationStyle": "鼓励为主", "strictness": "宽松", "parentGoals": [] },
    "effective_settings": { "philosophy": "自主探索", "communicationStyle": "鼓励为主", "strictness": "严格", "parentGoals": ["每天写一段"] },
    "child_overrides": ["philosophy", "strictness", "parentGoals"],
    "inherits_family": false
  }
]
```

`PATCH` 请求体：

```json
{
  "skill_id": "writing-coach",
  "philosophy": "自主探索",
  "communication_style": "鼓励为主",
  "strictness": "严格",
  "parent_goals": ["每天写一段"],
  "notes": "写字慢，需要先口述再动笔",
  "clear": false
}
```

错误约定：

| 场景 | 返回 |
|---|---|
| `childId` 不属于当前家庭 | `404 { error: "学生不存在" }`（与现有 `ownsResource` 行为一致，不泄露存在性） |
| 缺 `skill_id` | `400 { error: "缺少 skill_id" }` |
| `skill_id` 不存在 | `404`，复用"教育技能不存在" |

### 7.2 MCP（WorkBuddy / 豆包，家庭身份来自授权）

新增 3 个工具，扩展 3 个既有工具：

| 工具 | 变更 | 说明 |
|---|---|---|
| `get_effective_skill` | **加可选 `child_id`** | 传了就返回"家庭 + 孩子"合并结果；不传与今天一致 |
| `get_child_education_profile` | **新增** | 读某个孩子各场景的个体配置与最终设置 |
| `update_child_education_profile` | **新增** | 写某个孩子的个体配置；`clear: true` 清空 |
| `list_family_policies` | **加可选 `child_id`** | 传了附带该孩子的个体配置 |
| `update_family_policy` | **加可选 `child_id`** | 传了写孩子级，不传写家庭级 |
| `get_sync_spec` | 版本升到 `2.6` | 增加 `child_dimension_rule` 与 `education_style` 工作流 |

**兼容性承诺（写给所有既有调用方）**：

- 所有新增参数都是**可选**；不传时返回值与字段含义不变。
- 返回对象**只做加法**：新增 `child_id`、`child_name`、`child_profile`、`child_overrides`、`resolved_settings`、`resolution`；既有 `skill` / `profile` / `overrides` / `recommended_methods` / `effective_content` 保留原语义。
- 不传 `child_id` 时 `effective_content` 不追加"孩子个体差异配置"段落。
- 家庭身份仍然只来自授权（OAuth / 家庭 Token），**不接受调用方传入 `family_id`**；`child_id` 必须能在当前家庭内校验通过。

### 7.3 孩子维度规则（写进 `get_sync_spec` 与提示词）

> 同一家庭的不同孩子可以有各自的教育方式。执行某个孩子的任务前先调用 `get_effective_skill` 并传 `child_id`，拿到「家庭策略 + 孩子个体调整」合并后的结果；只有传了 `child_id` 才会应用孩子级配置。家庭级配置用 `list_family_policies` / `update_family_policy`（不传 `child_id`），孩子级配置用 `get_child_education_profile` / `update_child_education_profile`。不要把一个孩子的偏好套用到另一个孩子身上。

## 8. 前端入口

### 8.1 小程序：学生详情 → 教育方式

新增页面 `miniprogram/pages/child-education/`，入口放在学生详情页（与「当前状态」「成长记录」「学习诊断」同级）。

页面结构（自上而下）：

1. **头部**：孩子头像 + 姓名 + 状态条 —— `当前继承家庭设置` 或 `已按这个孩子单独设置`。
2. **场景标签**：成长分析 / 作业规划 / 家长沟通 / 阅读引导 / 写作指导。有单独设置的场景带小圆点。
3. **设置区**（只作用于当前场景）：教育理念、沟通风格、严格程度、这个孩子的家长目标、这个孩子的学习特点。
4. **操作**：`保存这个孩子的教育方式`、`应用到全部场景`、`恢复为继承家庭设置`（仅在有单独设置时出现，二次确认）。

交互与文案约束：

- 选项用**分段选择**（chip），不用下拉框；触控目标高度不低于 60rpx。
- 「恢复为继承家庭设置」是危险操作，需二次确认，确认文案写明"改为跟随家庭统一设置"。
- 空状态：某场景没有任何配置时，展示家庭设置值并标注"继承中"，**不显示占位假数据**。
- 移动端交互规范：不在卡片里内联放"编辑 / 删除"文字按钮；本页即二级页面，设置项就地编辑，破坏性操作放在页面底部。

### 8.2 网页端：学生页入口

网页端「学生」页当前只有基础信息表格（`apps/web/src/App.tsx` 中 `page === "students"` 分支）。本次：

- 表格行增加「教育方式」入口，打开孩子级设置面板（复用 8.1 的字段与语义）。
- 顺带收尾网页端 `saveEducationSettings` 死代码：要么接入设置面板，要么移除，避免留下"看起来能改、其实没接上"的入口。同时明确网页端设置页写的是家庭级，孩子级只在学生页改。

### 8.3 家庭设置页的定位调整

小程序 `settings-detail` 与网页端设置是**家庭级**入口，文案需要明确：

> 这是全家的默认教育方式。个别孩子可以单独设置，见「学生 → 教育方式」。

避免家长误以为改了家庭设置就改不了单个孩子，或反之。

## 9. 与 WorkBuddy / 豆包的协同

### 9.1 `get_agent_bootstrap` 启动指令增补

在既有启动步骤后追加：

> 教育方式按孩子区分：执行某个孩子的任务时，先调用 `get_effective_skill` 并传 `child_id`，再按返回的合并结果执行；不要把一个孩子的偏好用到另一个孩子身上。

`workflow_router` 增加：

```json
"education_style": ["list_children", "get_child_education_profile", "get_effective_skill(child_id)", "update_child_education_profile"]
```

### 9.2 提示词增补

在 `buildEducationAgentPrompt` 的"教育方式（按孩子维度）"节中写清四件事：读孩子级、写要区分家庭级/孩子级、恢复默认用 `clear`、不跨孩子套用。

### 9.3 谁改、怎么改

| 角色 | 能力 |
|---|---|
| 家长（家庭创建者 / 管理者） | 在小程序或网页端直接改孩子级配置，立即生效 |
| WorkBuddy / 豆包 | 通过 `update_child_education_profile` 写入，同样走 `PolicyChange` 留痕（`createdBy` 记录来源） |
| 未来的"提议-确认"模式 | 复用现有 `proposePolicyChange` / `reviewPolicyChange`（`proposed → approved / ignored`），本次不做孩子级提议，等出现"AI 建议改这个孩子的教育方式"的真实需求再补 |

原则：**智能体可以写，但每一次写入都必须留痕，并且家长能看到、能改回**。不允许在提示词里硬编码某个孩子的教育方式。

## 10. 权限与守卫

### 10.1 守卫收敛

把 4 处重复的 `assertChildInFamily` 抽到 `apps/api/src/v2/guards.ts` 并导出，四处改为引用。孩子级教育方式读写复用同一个守卫。

好处：隔离规则只有一处实现，新模块不会再"忘记写一份"；这也是 `TUTOR_AGENT_DESIGN.md` 9.3 第三道防线的前置条件。

### 10.2 规则

- REST：家庭身份来自 JWT（`getAuth(request).familyId`），`childId` 必须通过 `ownsResource` 或守卫校验。
- MCP：家庭身份来自授权解析（OAuth Access Token / 家庭 Token），**不接受传入 `family_id`**；`child_id` 必须校验归属。
- 孩子级配置不可跨家庭读取；跨家庭请求一律 404 / 报错，不返回"存在但无权"。
- 同家庭内多个管理者都可改，同一份数据共享；冲突采用 last-write-wins，靠 `PolicyChange` 留痕可追溯。

## 11. 测试与验收

### 11.1 自动化（必须全部通过）

**API 单测** `apps/api/src/personalization.test.ts` 新增用例：

1. 不传 `child_id` 时不读孩子级表，结果与家庭级一致（向后兼容回归）。
2. 孩子级配置逐字段覆盖家庭级（含只设一部分字段的情形）。
3. 孩子没配置时自动继承家庭设置，且不追加"孩子个体差异配置"段落。
4. `active = false` 的孩子级配置不生效。
5. 传别的家庭的孩子 id 时被拒绝。
6. 写入孩子级时 `childId` / `familyId` 正确落库，并写 `PolicyChange(childId)`。
7. `clear` 后回到继承状态。
8. 按孩子汇总每个 Skill 的最终设置与覆盖字段。
9. 家庭与孩子都没有配置时回落到默认值（`resolution = default`）。

**小程序逻辑测试** `scripts/test-miniprogram-logic.mjs` 新增用例：

1. 读取每个教育场景的配置并展示合并后的最终设置。
2. 切换场景读取该场景的设置。
3. 孩子个体说明按场景回填。
4. 保存写入当前场景，家长目标按分隔符拆分。
5. 恢复继承走 `clear` 分支。

**既有基线**：`npm test`（API 全量 + 小程序逻辑 + 小程序校验）、`npm run build`。

### 11.2 人工验收

| 场景 | 期望 |
|---|---|
| 家庭设"习惯优先"，孩子 A 单独设"自主探索" | A 显示自主探索；孩子 B 仍显示习惯优先 |
| 孩子 A 只改严格程度 | A 的理念、沟通风格仍跟随家庭 |
| 点「恢复为继承家庭设置」 | A 回到家庭设置，且历史写入仍可在变更记录中查到 |
| WorkBuddy 读 `get_effective_skill(child_id=A)` | 返回 A 的合并结果，`resolution = child` |
| WorkBuddy 读 `get_effective_skill()`（不带 child_id） | 与改造前一致，不带孩子段落 |
| 第二个家长账号登录 | 看到同一份孩子级配置（家庭内共享） |

### 11.3 回归清单（改动会碰到的地方）

- `GET /api/policies`、`GET /api/policies/:skillId/effective`、`PATCH /api/policies/:skillId`
- MCP `list_family_policies` / `get_effective_skill` / `update_family_policy`
- `apps/api/src/mcp.ts` 的 `get_sync_spec` 输出（版本号变化会进入 WorkBuddy 视野）
- WorkBuddy 连接提示词与豆包备用提示词（`apps/api/src/workbuddy-prompt.ts`）
- 小程序 `settings-detail` 的家庭级保存路径

## 12. 落地步骤（确认后统一实施）

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | `prisma/schema.prisma` 加 `ChildSkillProfile`、`PolicyChange.childId`，新增迁移 | `prisma migrate deploy` 成功；存量数据行数不变 |
| 2 | `personalization.ts` 三层解析 + 孩子级读写 + `clear` | 本文件 11.1 的 1–9 全绿 |
| 3 | 守卫收敛到 `v2/guards.ts` | API 全量测试通过 |
| 4 | REST 5 个入口 | 手工调用返回形状符合 7.1 |
| 5 | MCP 3 新增 + 3 扩展 + `get_sync_spec` 2.6 | MCP smoke test 通过；不带 `child_id` 输出无变化 |
| 6 | WorkBuddy / 豆包提示词与 bootstrap 增补 | `workbuddy-prompt` 单测通过 |
| 7 | 小程序 `child-education` 页面 + 学生详情入口 | 小程序校验 + 逻辑测试通过 |
| 8 | 网页端学生页入口 + 家庭设置文案 | `npm run build` 通过 |
| 9 | 文档回填：`docs/MCP.md`、`docs/workbuddy-sync-spec.md`、`docs/TECHNICAL_DESIGN_V2.md` 6.3/8.2/9.1、PRD、`README.md` | 文档与实现一致 |
| 10 | 三视口校验 + 部署到 `heyaagent.top` | `npm run verify:web-responsive`；公网 Web / API / MCP 走通 |

### 12.1 影响面与风险

| 风险 | 处置 |
|---|---|
| WorkBuddy 正在读 `get_effective_skill` | 参数可选、返回只加字段；步骤 5 单独做一次"不带 child_id 输出对比"验证 |
| 迁移误伤存量数据 | 迁移只做新增；执行前备份，执行后比对行数 |
| 提示词版本变化导致 WorkBuddy 行为漂移 | `get_sync_spec` 版本号显式升级，并在 `workbuddy-sync-spec.md` 记录差异 |
| 家长误以为改了家庭设置就影响所有孩子 | 8.3 的文案说明 + 孩子页的"继承中 / 已单独设置"状态标识 |

### 12.2 登记但不在本次实施

- **技能文件化（缺口 B）**：`getEducationSkill()` 仍是 `fs.readFileSync` 读 `skills/*.md`，改一条技能要发版。建议"文件作种子、数据库作真源"，但会改变技能加载路径与 WorkBuddy 看到的技能内容，风险等级高于本设计，单独排期。
- **旧字符串匹配推荐收敛**：`personalization.ts:116` 的 `recommendEducationMethods` 仍在进入 WorkBuddy 视野（`ARCHITECTURE_PROPOSAL_V2.md` 1.3）。本设计不改动这条链路，避免与孩子维度改造混在一起。
- **孩子级覆盖家庭边界**：见 13.1。

## 13. 未决问题（需要产品确认）

### 13.1 家庭边界要不要也能按孩子设？

本设计把孩子级限定为"教育方式"（理念 / 沟通风格 / 严格程度 / 家长目标 / 学习特点），**家庭边界**（每周学习时间预算、优先学科、压力边界）保持家庭级。

理由：边界类字段是家庭资源的分配结果（总时间、总压力），按孩子各设一套容易出现互相矛盾的约束，也更容易被误用成"给这个孩子加码"。如果确实需要"弟弟每周 120 分钟、哥哥每周 300 分钟"，建议另立设计，把它作为"孩子计划配额"而不是"家庭边界的孩子副本"。

### 13.2 教育理念要不要在系统内固定成枚举？

现在理念是自由文本 + 若干常见取值（`以引导和鼓励为主` / `兴趣优先` / `习惯优先` / `成绩与能力并重` / `自主探索`）。费曼学习法、蒙特梭利这类"流派"目前由 `EducationMethod` 方法库承载，不由家长在教育理念里选。

待确认：是保持现状（理念是方向、方法库是工具），还是把理念升级为可枚举、可版本化的资源。后者会影响孩子级字段类型与迁移。

### 13.3 孩子级改动要不要走"提议-确认"？

当前设计：家长直接改，立即生效；智能体写入也直接生效但留痕。若希望"AI 只能提议、家长确认后才生效"，可以复用 `proposePolicyChange` / `reviewPolicyChange`，把 `createdBy` 为智能体的孩子级改动置为 `proposed`。需要产品决定，因为这会影响家长的操作步数。

### 13.4 多个管理者同时修改的冲突处理

当前为 last-write-wins + 变更留痕。是否需要乐观锁（`updatedAt` 比对）或改动通知，取决于家长实际协作频率。

## 14. 不变更清单

以下内容本次**明确不动**，作为实施时的边界：

- WorkBuddy 开放平台连接器与 OAuth 扫码授权流程；
- MCP 的家庭身份解析（`resolveFamilyByOAuthAccessToken` / `resolveFamilyByMcpToken`）；
- `FamilySkillProfile` 的既有唯一键与语义（家庭级仍然存在且是默认来源）；
- `EducationMethod` / `MethodEffect`（教育方法库与效果记录）；
- 题库、错题本、知识库、教材、作业、成长记录的数据模型；
- 小程序与网页端现有导航结构（只**新增**孩子级入口，不重排既有页面）；
- 服务器上其他系统与 nginx 配置（仅在本项目既有 `/family-edu/` 路径下部署）。
