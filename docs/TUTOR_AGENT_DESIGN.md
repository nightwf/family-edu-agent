# 禾芽内置学习私教（Education Agent Layer）技术方案

## 1. 文档范围

本方案说明如何在禾芽现有系统之上，增加一个可对话的学习私教智能体，用于孩子随时提问、讲错题、做口语与阅读陪练，覆盖网页端、安卓端，并预留微信小程序。

不在本方案范围内：

- 不改动 WorkBuddy 的连接协议与已提交开放平台的专家包；
- 不建设独立的大模型训练能力，不训练自有语音模型；
- 不新建第二套 MCP 工具集。

关联文档：`docs/TECHNICAL_DESIGN_V2.md`、`docs/MCP.md`、`docs/workbuddy-sync-spec.md`、`docs/android-app.md`。

---

## 2. 结论先行

用库搭建轻量 Agent Runtime，复用现有 MCP 工具作为唯一工具来源；模型、语音、审核能力全部租用，领域记忆与教学策略自建。

三条产品边界，决定所有技术取舍：

1. 按用户分，不按功能分。WorkBuddy 是家长的控制台（规划、录入、纠偏）；内置私教是孩子手里的（讲题、陪练、随时问）。二者共用一份数据与一套工具，不是同一件事的两个入口。
2. 教育理念只有一个家。私教的人格与教法一律从 `FamilyPolicy`、`EducationMethod`、`SkillOverride` 读取，不写死在提示词里，也不托管给第三方平台。
3. 单一账号，不做权限分层。私教归家长账号使用，本期不建第二套账号体系、不做角色权限。工具白名单限制的是"模型能自主做什么"（不开放联网检索与自由文件操作），不是"谁能用"。

"到底要自己写多少"见 4.1：框架的两大底座（工具协议、模型通信）都是现成的，自己写的是中间那层薄的编排与领域逻辑。

### 2.1 两个智能体，一份数据

WorkBuddy 的接入方式**完全不变**；本方案是**再加一个**禾芽内部的对话入口，两者共用同一份后台数据。不是二选一，也不是把 WorkBuddy 换掉。

| | WorkBuddy 接入（不变） | 内部聊天（新增） |
|---|---|---|
| 谁来用 | 家长，在 WorkBuddy 自己的界面里 | 孩子，在禾芽的网页与安卓里 |
| 谁发起 | WorkBuddy 主动调禾芽 MCP（入站） | 禾芽服务端驱动 |
| 通道 | `POST /family-edu/mcp` + `X-MCP-Token` | 进程内 MCP，无令牌 |
| 擅长 | 生成类：规划、出题、长文（批量、可异步） | 对话类：讲错题、陪练、随问随答（逐轮、需流式） |
| 家庭标识 | 由 `X-MCP-Token` 解析 | 由登录会话 `familyId` 注入 |

「共用同一份数据」的确切含义，落到实现是五条：

1. **同一套工具**：两边都调那 123 个 MCP 工具，内部聊天不新写一套；
2. **同一套领域服务与表**：都读写 `apps/api/src/v2/*` 与同一个 PostgreSQL；
3. **同一份教育理念**：都从 `FamilyPolicy`、`EducationMethod` 读取，谁都不存副本；
4. **同一套确认流程**：两边的证据都进 `PENDING_CONFIRMATION`，家长确认后才生效；
5. **写入有归属**：`EvidenceRecord.source` 与 `AuditLog.actorType` 都是自由字符串，内部聊天以 `source: "tutor"` 落库（`createEvidenceRecord` 已接受 `actor` 参数，默认 `workbuddy`），家长能分清哪条是 AI 聊出来的、哪条是 WorkBuddy 同步来的。

### 2.2 为什么对话入口不能只靠 WorkBuddy

`docs/ARCHITECTURE_PROPOSAL_V2.md` 3.3 有一句「禾芽不重复建设第二套大模型能力」。那句约束的是**生成类**任务，本方案不碰它：需要规划时，私教不自己规划，走现有 `PlanningRequest` 流程交回 WorkBuddy，闭环仍然只有一条。私教承载的是**实时对话运行时**，两者的差别是结构性的：

| 维度 | 生成类（WorkBuddy） | 对话运行时（禾芽私教） |
|---|---|---|
| 调用方向 | WorkBuddy 主动调禾芽 MCP（入站） | 禾芽服务端驱动 |
| 时序 | 批量、可异步 | 逐轮实时、需流式 |
| 交互面 | WorkBuddy 自己的界面 | 禾芽的网页与安卓界面内 |
| 语音 | 不涉及 | 需双向音频流 |
| 资源归属 | WorkBuddy 的额度与密钥 | 禾芽的额度与密钥 |

无法把私教交给 WorkBuddy 的三条技术原因：

1. **MCP 是入站且无长连接的。** 现有实现每次请求新建服务端（`sessionIdGenerator: undefined`，见 `apps/api/src/mcp.ts`），WorkBuddy 不保持连接，禾芽没有反向发起对话的通道。
2. **异步通道是请求应答，不是对话流。** 架构里的「禾芽 → WorkBuddy 云端任务」至今未实现，且语义是批量任务回写，给不了逐轮流式。
3. **交互面在禾芽自己手里。** 孩子是在网页与安卓里对话，WorkBuddy 是另一款产品，其对话界面无法嵌入禾芽。

理论上还有第三条路：MCP 的 `sampling/createMessage` 允许服务端反向请求客户端跑模型，SDK 已支持该能力。但采样要求客户端连接保持存活，与当前无状态传输冲突，且无法解决嵌入与语音问题，故不作为方案。

一处既有约束需要留意：`update_student_question_type_mastery` 与 `update_wrong_question_status` 两个工具的 `source` 参数是封闭枚举 `["parent", "workbuddy"]`，不接受新取值。按本方案的工具白名单，内部聊天**不写人工修正**（掌握度与错题状态的人工修正属于人的判断，且要家长确认），因此不需要扩展这个枚举；若以后要放开，改这两处 zod 定义即可。

共同约束不变（这是原则的本意，也是必须守住的）：

1. 教育理念只有一份：私教与 WorkBuddy 都从 `FamilyPolicy`、`EducationMethod` 读取，不各自存副本；
2. 数据只有一份：两边都通过同一套 MCP 工具与领域服务读写，证据都走 `PENDING_CONFIRMATION`；
3. 生成逻辑不复制：私教不重写规划与出题，一律交回既有流程。

---

## 3. 系统上下文

```
                        ┌──────────────────────────────┐
   孩子（网页 / 安卓）    │  禾芽 Web（apps/web）          │
   ───────────────────▶ │  Chat 页面（新增）             │
                        └──────────────┬───────────────┘
                                       │ SSE 流式
                        ┌──────────────▼───────────────┐
   家长（网页 / 小程序） │  禾芽 API（apps/api）          │
   ───────────────────▶ │  /api/tutor/*  （新增）        │
                        │   ├─ Agent Runtime（新增）     │
                        │   ├─ 内容安全层（新增）         │
                        │   ├─ 教学策略层（新增）         │
                        │   └─ MCP Server（已有）        │
                        └──────────────┬───────────────┘
                                       │ 进程内 InMemoryTransport
                        ┌──────────────▼───────────────┐
                        │  现有 123 个 MCP 工具           │
                        │  child / wrong / mastery /    │
                        │  policy / method / plan ...   │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  PostgreSQL（业务与记忆）      │
                        │  S3 / MinIO（图片等附件）      │
                        └──────────────────────────────┘

   外部租用：对话模型（多模态）、内容审核、语音识别 / 合成（分阶段接入）
```

关键点：私教不自建工具，而是以进程内 MCP 客户端身份调用同一个 MCP Server。工具只有一处定义，WorkBuddy 与私教永远不会分叉。

---

## 4. 为什么复用 MCP 工具而不是新写一套

现有 `apps/api/src/mcp.ts` 与 `apps/api/src/v2/mcp-tools.ts` 已注册 123 个工具（实测统计），私教第一阶段要用到的全部就绪：

| 用途 | 已有工具 |
|---|---|
| 认识孩子 | `list_children`、`get_child_context`、`get_child_state` |
| 教育理念与教法 | `get_family_policy`、`list_education_methods`、`get_coaching_policy`、`get_effective_skill` |
| 学情与优先级 | `get_learning_priorities`、`get_learning_history`、`list_learning_signals`、`get_planning_context` |
| 讲错题 | `list_wrong_questions`、`get_wrong_question`、`get_wrong_question_practice_context` |
| 掌握度 | `list_student_mastery`、`get_student_question_type_mastery` |
| 回写证据 | `record_question_attempt`、`save_wrong_question`、`save_knowledge_item` |

实现方式（MCP SDK `1.30.0` 已安装，含 `InMemoryTransport.createLinkedPair()`）：

```ts
// apps/api/src/tutor/mcp-tools.ts（新增）
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEducationMcpServer } from "../mcp.js";

export async function createTutorToolset(familyId: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createEducationMcpServer(familyId);
  const client = new Client({ name: "heya-tutor", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}
```

好处：无 HTTP 回环、无自签令牌、家庭隔离沿用 `resolveFamily()` 既有语义（`familyId` 由服务端会话推导，不接受客户端传入）。

一处需要补齐的缺口：**学科概览目前没有 MCP 工具**（`getSubjectOverview` 只在 `apps/api/src/v2/subject-overview.ts` 里供 REST 使用，首页两端都走 `/api/mobile/subject-overview`）。私教要在对话里说"哪一科需要优先处理"，有两条路：

1. 阶段一先不加工具，靠 `get_learning_priorities` 的 `subject` 字段回答单点问题；
2. 顺手补一个只读工具 `get_subject_overview`，同时给 WorkBuddy 用（对两边都有收益，且属于纯增量）。

建议按 2 做：新增只读工具不影响任何现有契约。

### 4.1 建设方式：哪些装库，哪些自己写

一个完整 Agent 框架通常由几层构成，**不是都要自己写**。按本项目实际情况拆开：

| 层 | 通常包含什么 | 本项目来源 | 需自写（估算） |
|---|---|---|---|
| 工具协议层 | 工具定义、参数 schema、发现、调用、结果回传 | MCP SDK 已装 | 0 行 |
| 模型通信层 | 请求组装、流式增量、工具调用解析、重试 | 装一个厂商 SDK | 约 100 行适配 |
| 编排层 | 模型与工具的循环、轮次上限、超时、取消 | 自己写 | 约 200 行 |
| 领域层 | 工具白名单、人格渲染、记忆、安全、配额 | 自己写 | 约 400 行 |
| 界面层 | 消息流、流式渲染、输入框、图片与语音按钮 | 自己写 | 约 300 行 |

即：**框架的两大底座都是现成的，自己写的是中间的编排与领域逻辑**，阶段一合计约 900 行业务代码（不含测试）。这跟"从零写一个智能体框架"不是一个量级 —— 后者要自己实现工具协议、消息序列化、多供应商适配、会话状态机，那是几万行的事。

这三件事必须自己写，因为它们是产品本身，没有库能替：

1. 工具白名单与 `childId` 锁定（孩子端的权限边界）；
2. 人格提示词从教育理念渲染（否则理念会分叉）；
3. 输出安全替换与证据回流（聊天的价值闭环）。

这三件事不要自己写，因为它们是通用难题，重写只会踩坑并长期维护：

1. 模型协议适配：各家 tool-calling 与流式格式差异大，且持续变化；
2. 语音：声学模型、断句、打断检测，自研成本远超 API 费用；
3. 内容审核：合规资质与词库，自建既不合规也不划算。

编排层有两条路线，实施时二选一：

| 路线 | 做法 | 自写代码 | 取舍 |
|---|---|---|---|
| A 手写循环 | 只装模型 SDK，循环自己写 | 约 900 行 | 完全掌控第 12 节的 SSE 契约与三个介入点；需自己处理流式与工具异常的边界情况 |
| B 装编排库 | 装 Vercel AI SDK 这类通用编排库 | 约 500-600 行 | 少踩流式与工具调用的坑；需把它的消息格式适配成本方案的 SSE 契约 |

建议**先按 A 起手**。编排层本身小而清晰，而本方案要求的三个介入点 —— 输出审核替换整条消息、审计每轮工具调用、配额中途中断 —— 恰好是编排库最容易挡路的位置（要在流中间插手）。界面层若想省事，可以单独考虑装现成聊天组件，那与编排层无关。

补充一句判断依据：**框架层没有差异化价值，领域层才有。** 所以钱和精力应该花在领域层，框架层尽量租。

---

## 5. 目标代码结构

```
apps/api/src/tutor/
  routes.ts             # /api/tutor/* 路由与 SSE 输出
  runtime.ts            # Agent 循环：模型 ⇄ 工具
  mcp-tools.ts          # 进程内 MCP 客户端与工具白名单
  tool-policy.ts        # 按人格与场景的工具授权表
  persona.ts            # 私教人格：由教育理念渲染系统提示词
  safety.ts             # 内容安全三层入口
  memory.ts             # 记忆读写：会话摘要、证据回流
  quota.ts              # 每日额度与限流
  llm/
    index.ts            # 模型供应商抽象
    types.ts            # 统一的流式事件类型
  voice/
    index.ts            # 语音能力抽象（阶段二起）

prisma/migrations/2026xxxx_add_tutor_agent/   # 新增迁移
apps/web/src/components/TutorChat.tsx         # 聊天页
apps/web/src/lib/tutor.ts                     # SSE 客户端
```

---

## 6. 数据模型

新增迁移，不动现有账号、学生、题库、作业、知识库数据。

```prisma
model TutorConversation {
  id            String   @id @default(cuid())
  familyId      String
  childId       String                 // 会话归属的孩子，空表示家庭级（家长模式）
  persona       String   @default("child_tutor")  // child_tutor | parent_coach
  title         String?
  status        String   @default("active")        // active | archived
  summary       String?                // 滚动摘要，见第 9 节
  summarizedAt  DateTime?
  lastMessageAt DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model TutorMessage {
  id               String   @id @default(cuid())
  conversationId   String
  familyId         String
  childId          String?
  role             String                       // user | assistant | tool
  content          String?
  contentJson      Json?                        // 结构化回答：讲解步骤、引用到的错题 ID 等
  attachments      Json?                        // [{ objectKey, contentType, kind }]
  toolCalls        Json?                        // 审计：本轮调用了哪些工具
  moderationStatus String   @default("passed")  // passed | flagged | blocked
  model            String?
  promptTokens     Int?
  completionTokens Int?
  createdAt        DateTime @default(now())
}

model TutorSafetyEvent {
  id             String   @id @default(cuid())
  familyId       String
  childId        String?
  conversationId String?
  stage          String                       // input | output
  reason         String
  excerpt        String?
  action         String                       // blocked | replaced | logged
  createdAt      DateTime @default(now())
}
```

索引按现有 schema 风格在迁移中补：`TutorConversation` 建 `(familyId, childId, lastMessageAt)`；`TutorMessage` 建 `(conversationId, createdAt)` 与 `(familyId, childId, createdAt)`；`TutorSafetyEvent` 建 `(familyId, createdAt)`。

复用现有模型，不新增：

- 图片与文件：沿用 `StoredObject` 与 `apps/api/src/storage.ts` 的 `saveFile()`（已是 S3/MinIO，本地落盘兜底）；
- 记忆的领域部分：`EvidenceRecord`、`ChildStateSnapshot`、`ChildRelationshipSnapshot`、`StageReport`；
- 审计：沿用 `AuditLog`。

`TutorMessage` 与业务表分开，是为了让"聊天内容"和"教育证据"职责清晰：聊天是原料，确认后沉淀为证据。

---

## 7. Agent Runtime

### 7.1 循环

```
用户消息（可带图片）
  → L1 输入安全检查
  → 组装上下文：人格提示词 + 最近若干轮 + 会话摘要 + 本次附件
  → 模型流式输出
      ├─ 需要工具 → 校验授权 → 进程内 MCP 调用 → 结果回灌 → 继续
      └─ 结束
  → L3 输出安全检查
  → 落库 + 流式回传前端
```

硬约束：

- 最大工具轮次 6，超限停止并给出自然收尾，不无限循环；
- 单轮总超时 45 秒，超时中断并保留已产出内容；
- 工具结果截断到配置上限（默认 6KB/次），避免把整本错题本塞进上下文；
- 模型调用失败时降级为可理解提示，不留白屏。

### 7.2 工具白名单

`tool-policy.ts` 定义授权表，运行时按 `persona` 过滤。默认拒绝，未列入的工具一律不可见（既不给模型，也不出现在列表里）。

| 工具 | child_tutor | parent_coach | 说明 |
|---|---|---|---|
| `list_children`、`get_child_context`、`get_child_state` | 仅当前孩子 | 可用 | 孩子端强制锁定 `childId` |
| `get_family_policy`、`list_education_methods`、`get_coaching_policy` | 只读 | 只读 | 理念来源 |
| `get_learning_priorities`、`get_learning_history`、`get_subject_overview`（新增只读） | 可用 | 可用 | 学情 |
| `list_wrong_questions`、`get_wrong_question`、`get_wrong_question_practice_context` | 可用 | 可用 | 讲题核心 |
| `list_student_mastery`、`get_student_question_type_mastery` | 可用 | 可用 | 掌握度 |
| `record_question_attempt` | 需显式确认 | 可用 | 孩子答完才能记 |
| `save_wrong_question` | 禁止 | 可用 | 录错题归家长 / WorkBuddy |
| `delete_*`、`update_family_policy`、`propose_policy_change` | 禁止 | 部分 | 变更类一律不进孩子端 |

孩子端额外约束：`childId` 由服务端会话固定注入，模型即使请求其它 `childId` 也会被 `tool-policy` 拦掉，返回中性回复。

### 7.3 模型供应商抽象

```ts
// apps/api/src/tutor/llm/types.ts
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "done"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "error"; message: string };

export interface ChatProvider {
  name: string;
  supportsVision: boolean;
  streamChat(input: ChatInput, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
```

抽象层的作用是能换供应商、能按场景选模型（讲题用强模型、纯陪聊用便宜模型）。具体供应商、型号与计费在实施时以官方文档为准核对，本方案不固化型号。

---

## 8. 内容安全（三层）

三层职责不同，不能合并。

### L1 输入侧

- 单条长度上限（默认 2000 字）、每小时消息数上限（见第 12 节配额）；
- 敏感内容审核（租用云审核 API，文本与图片各一次）；
- 命中即拦截，写家长可见记录，孩子端只给中性提示。

### L2 教学策略（核心资产，必须自建）

系统提示词由 `persona.ts` 在每次请求时服务端渲染，来源：

- `get_family_policy`：边界、压力承受度、家长目标；
- `list_education_methods` + `get_effective_skill`：本家庭生效的教育方法；
- `get_child_state` + `get_subject_overview`：孩子当前状态与关注学科。

硬规则（写在提示词前端，优先级高于模型自由发挥）：

1. 不直接给答案：先问思路、给提示、让孩子自己算；连续两次不会才逐步给步骤。
2. 一次只教一个点，讲完给一道同型小题验证。
3. 语气与严格度服从家庭设置，不使用羞辱、比较、威胁式表达。
4. 不确定就说不确定，不编造孩子的记录；讲题必须引用真实存在的错题或题目 ID。
5. 超出学科与陪伴范围的话题，温和收回。

### L3 输出侧

- 输出审核再跑一次（模型可能被诱导产生越界内容）；
- 结构化回答校验：引用到的 `wrong_question_id` / `question_id` 必须属于本家庭，否则整条降级为纯文本；
- 命中拦截时替换为孩子可接受的回复，并写 `TutorSafetyEvent`。

---

## 9. 记忆设计

分三层，各司其职。通用 agent 框架的记忆是向量召回，替不了第一层和第三层。

| 层 | 载体 | 生命周期 |
|---|---|---|
| 短期 | 最近 N 轮原文（默认 12 轮，按 token 裁剪） | 单次会话 |
| 中期 | `TutorConversation.summary` 滚动摘要 | 跨会话，超窗口时重算 |
| 长期 | `EvidenceRecord` / `ChildStateSnapshot` / `ChildRelationshipSnapshot` | 领域记忆，永久 |

### 9.1 回流为教育证据

这是私教相对普通聊天工具的本质区别：聊天会变成孩子的记录。

- 会话结束，或用户主动点"记录这次情况"，`memory.ts` 从本轮对话抽取一条结构化证据；
- 写入 `EvidenceRecord`，`type` 取现有枚举中的合适值，`source` 取 `tutor`，`reviewStatus` 沿用 `PENDING_CONFIRMATION`；
- 家长在网页端"孩子状态"确认或纠正，流程与 WorkBuddy 写入的证据完全一致；
- 只有 `CONFIRMED` 的证据才进入 `ChildStateSnapshot` 计算。

写入前必须去重（同一 `childId + type + 时间窗` 合并），且只写孩子确实做过的行为，不写模型推测。

### 9.2 避免历史数据污染

1. 上下文只喂当前有效：读取一律带 `asOf` 窗口，默认 42 天；更早历史只通过快照 `ChildStateSnapshot.summary` 参与，不喂原文。
2. 教材与知识点按版本取用：`KnowledgeNode` 带版本，孩子升年级后旧版本保留但不再进入默认上下文。
3. 证据有生命周期：`SUPERSEDED` 状态的证据不参与新结论计算，但保留可追溯。
4. 掌握度只看最新评估：`StudentQuestionTypeMastery` 以最近评估为准，历史作答只作证据。

原则一句话：历史用于解释，当前用于决策。

### 9.3 多孩子之间的记忆隔离

家庭隔离靠 `familyId`，这个已有机制很稳（MCP 走 `resolveFamily()`，REST 走 `getAuth()`）。但**同一个家庭里的两个孩子之间**是更容易漏的一层，因为家庭是合法共享的，一旦漏判不会有任何权限错误，只会静默串数据。四道防线：

**第一道：结构上带住 `childId`。** 会话表 `childId` 在孩子模式下非空；所有读写一律同时带 `familyId` 与 `childId` 两个条件，不允许只按会话 id 查出来后直接信任。

**第二道：会话创建时钉住 `childId`，模型永远改不了。** 这是最关键的一道。运行时把 `childId` 钉在会话上，工具调用时**服务端覆盖** `child_id` 参数；模型即使拼出一个别的孩子的 id，也会被替换回钉住的值。孩子端不提供"切换孩子"的能力。

**第三道：一处守卫，不要各写一份。** 现状是 `assertChildInFamily` 在四个模块里各写了一份局部实现（`v2/evidence.ts:20`、`v2/goal-plan.ts:8`、`v2/relationship.ts:4`、`v2/reports.ts:4`），未导出、无统一入口。这意味着隔离靠"每个新模块记得自己写一个"。私教模块**不应再写第五份**，应先把这四处抽成一个导出的守卫模块（如 `apps/api/src/v2/guards.ts`），私教复用它，并补一个 `assertConversationInFamily`。

**第四道：`list_children` 在孩子模式下收敛。** 该工具的 `childId` 是参数，孩子端只返回钉住的那一个孩子；兄弟姐妹列表属于家长模式。同理，`get_child_context` 等所有接受 `child_id` 的只读工具都经第二道覆盖。

配套两条：

- **摘要与证据必须按孩子归类**：`TutorConversation.summary` 挂在会话上（会话已归属孩子），`EvidenceRecord` 本身有 `childId`；生成摘要时不得跨孩子聚合。
- **验收要测"同家庭不同孩子"**，不只是"不同家庭"。第 17 节原有的用例只覆盖了跨家庭，那是最容易通过的一类；同家庭跨孩子才是真正会漏的一类，必须补成独立用例。

### 9.4 规则与 Skill 怎么演进

**现状（已核实）**：教育技能是文件式的（`skills/*.md` + `index.json`，由 `apps/api/src/education.ts` 用 `fs.readFileSync` 读取），数据库里 `SkillVersion` 存版本但内容以文件为源；个性化则走 `FamilySkillProfile`（家庭级）+ `SkillOverride`（家庭级覆盖）。

这里有两个缺口必须指出，因为它们直接决定"以后能不能给孩子各自定规则"：

**缺口 A：策略与技能层没有孩子维度。** `FamilyPolicy` 是 `familyId @unique`（一家一条），`FamilySkillProfile` 是 `@@unique([familyId, skillId])`，`Child` 模型上也没有任何风格或偏好字段。也就是说**同一家的两个孩子现在必然共用一套教育方式**。而产品方向是"不同孩子情况不同，教育方式也应不同"，所以需要补孩子维度。

建议的解析顺序（三层，逐层覆盖）：

```
全局基础技能（版本化）→ 家庭策略（边界、理念、家长目标）→ 孩子级调整（该孩子的偏好与适配）
```

实现上推荐新增 `ChildSkillProfile`（`@@unique([childId, skillId])`，结构对照 `FamilySkillProfile`），而不是把 `childId` 塞进现有表并改成可空 —— 后者要迁移既有数据且会让"家庭级"与"孩子级"混在一张表里。孩子级表可选、默认空，解析时"有则覆盖、无则继承"，不影响现有家庭。

**该缺口的完整设计已独立成文：[教育方式按孩子维度分层](CHILD_SCOPED_EDUCATION_DESIGN.md)**（数据模型、三层解析规则、REST/MCP 契约、前端入口、迁移与验收）。本文 9.4 只保留结论；实施细节与字段口径以该文为准。

**缺口 B：技能是文件式的，改一条要重新部署。** 这对"教育方法要持续迭代"是硬约束。建议**文件作种子、数据库作真源**：`SkillVersion` 已经是现成的版本表，把 `getEducationSkill()` 改成"先查库、库里没有回落到文件"，新增与修改技能就不再需要发版。

**谁改、怎么改：机制已经存在，不要另建一套。** 现状已有完整的提案-审核链：

- `PolicyChange`：`status` 走 `proposed → approved / ignored`，`effective` 标记是否生效；
- `SkillOverride`：带 `approvedBy`；
- `createSkillOverride(..., createdBy = "workbuddy")`、`proposePolicyChange(..., createdBy = "agent")`、`reviewPolicyChange(..., reviewer = "parent")`。

即：**智能体或 WorkBuddy 只能提议，家长/管理员批准后才生效**。这就是自迭代的基础——不需要新造审批流，私教只需复用 `proposePolicyChange` 提交建议，把改动交给家长确认。

一条硬约束：**私教的规则必须走这条链，不允许在提示词里内联硬编码**。否则孩子会拿到一套没经家长确认、也无法追溯的教育方式，这正是方案第 8 节 L2 要守住的东西。孩子一旦成长、教材一旦更新，历史规则按 `SkillVersion` 留痕，不被静默改写。

---

## 10. 多模态

### 10.1 输入：图片（第一阶段）

场景是孩子拍一道错题或作业照片问"这题怎么做"。

```
前端选图 → 压缩 → POST /api/tutor/attachments（multipart）
        → saveFile() 写入 S3/MinIO + StoredObject 落库
        → 返回 objectKey
        → 发消息时携带 objectKey
        → Runtime 取图 → 视觉模型识别 → 走讲题流程 → 可 save_wrong_question（仅家长模式）
```

要点：

- 图片只存对象存储，不进数据库 BLOB；
- 单张上限与压缩放在前端（默认长边 1600px），后端再校验；
- 识别结果以结构化文本落 `TutorMessage.contentJson`，图片本身保留可回溯；
- 图片审核走 L1，一次不漏。

### 10.2 输出：文档与图片（第三阶段，先不做）

理由：价值低、复杂度高、给孩子看生成图片还多一层内容责任。第二阶段先用模板渲染（题干、解析、错题整理成可打印页）满足"我要一份纸质练习"，不引入自由生图。

---

## 11. 语音（分三级台阶）

| 台阶 | 形态 | 实现 |
|---|---|---|
| A | 按住说话：录音 → 识别 → 文字回答 → 朗读 | ASR + TTS 云 API，前端串起来 |
| B | 免录制的连续对话 | 同上，自动断句 |
| C | 实时对话、可随时打断 | 实时语音 API（WebSocket 双向流） |

不做什么：不自建 ASR/TTS 模型，不做声纹克隆。

两个必须提前处理的技术点：

1. 儿童语音识别准确率明显低于成人。选型必须用真实儿童录音实测，这是体验分水岭。
2. 安卓端麦克风尚未打通。现有 `android/app/src/main/AndroidManifest.xml` 只声明了 `INTERNET`、`ACCESS_NETWORK_STATE` 与存储权限，且 `MainActivity` 没有实现 `WebChromeClient.onPermissionRequest`。启用语音必须补 `RECORD_AUDIO` 并在 WebView 内授权，否则网页端能用的功能在 APK 里会静默失败。

本期语音只在安卓 APK 端启用：这是唯一必须重新打包发版的场景。微信小程序音频能力受限且审核更严格，本期不做。

---

## 12. 接口契约

统一挂在现有 API 服务，复用 `requireAuth`，家庭边界由会话推导。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/tutor/conversations?child_id=` | 会话列表 |
| `POST` | `/api/tutor/conversations` | 新建会话（含 `persona`） |
| `GET` | `/api/tutor/conversations/:id/messages` | 历史消息（分页） |
| `POST` | `/api/tutor/conversations/:id/messages` | 发消息，`text/event-stream` 流式返回 |
| `POST` | `/api/tutor/conversations/:id/attachments` | 上传图片，返回 `objectKey` |
| `POST` | `/api/tutor/conversations/:id/summarize` | 生成或更新摘要 |
| `POST` | `/api/tutor/conversations/:id/evidence` | 把本轮沉淀为 `EvidenceRecord`（待确认） |
| `DELETE` | `/api/tutor/conversations/:id` | 归档会话 |
| `GET` | `/api/tutor/quota` | 今日剩余额度 |

SSE 事件类型：

```
event: text     data: {"delta":"..."}
event: tool     data: {"name":"get_wrong_question","ok":true}
event: replace  data: {"reason":"safety"}
event: done     data: {"messageId":"...","usage":{...},"quotaLeft":12}
event: error    data: {"message":"...","retryable":true}
```

### 配额

- 每孩子每日消息数上限（默认 60）与每日 token 上限（可配）；
- 单会话消息数上限（默认 200，超出提示开新会话）；
- 超限返回可读提示，不报 500；
- 用量记在 `TutorMessage` 与 `TutorConversation`，`/api/tutor/quota` 汇总。

---

## 13. 前端

### 13.1 入口位置：只在安卓 APK 端（本期）

私教入口本期**只在安卓 APK 里出现**，网页端与小程序不加入口。

实现方式不需要改 APK：APK 是 WebView 承载线上站点（`MainActivity.HOME_URL = "https://heyaagent.top/"`），且 `MainActivity` 已给 UA 附加 `HeYaAndroid/1.0`（`MainActivity.java:171`）。前端读 UA 决定是否渲染入口即可，组件本身仍写在 `apps/web/src/components/TutorChat.tsx`。

两点必须说清楚：

1. **UA 是产品开关，不是安全边界。** UA 可伪造，所以不能靠它保护数据。本期安全的依据是账号本身：能进来的人就是家庭管理者，私教能读能写的范围本来就不超过他本人已有的权限。这也是"不需要做额外权限"能成立的原因。
2. **语音要发一次新版 APK。** `AndroidManifest.xml` 目前只声明了 `INTERNET`、`ACCESS_NETWORK_STATE` 与存储权限，且 `MainActivity` 未实现 `WebChromeClient.onPermissionRequest`。要做按住说话，必须补 `RECORD_AUDIO` 并在 WebView 内授权，否则网页端能用的功能在 APK 里会静默失败。这是本期唯一必须重新打包发版的动作。

### 13.2 界面

- 沿用现有明亮学堂设计语言（`rounded-2xl`、teal 主色），不引入第三方聊天组件；
- 消息流支持：文字、图片、流式打字、引用错题的卡片（点开进错题详情）、按住说话；
- 顶部带孩子切换（复用现有 `childName` 与切换逻辑）。

### 13.3 网页端与小程序（入口不开）

组件与接口都在，入口不开。后续要放开只需改 UA 判定这一处，不需要重做界面。小程序本期不做完整聊天。

---

## 14. 账号与数据隔离

本期不新建账号体系、不做角色权限。私教沿用家长账号：能打开 APK 的人就是家庭管理者，能读能写的范围不超过他已有的权限。安全靠账号与家庭边界，不靠界面隐藏。

以下四条仍然必须守住，但它们是**数据正确性与隐私**，不是权限分层：

- 所有 `/api/tutor/*` 走 `requireAuth`，`familyId` 只从会话取，不接受客户端传入（与现有 `getAuth(request)` 一致）；
- 会话、消息、附件、证据写入前一律校验所属 `familyId`，跨家庭不可见；
- 工具调用走进程内 MCP，家庭边界沿用 `resolveFamily()` 既有语义；
- `childId` 是数据维度（这段对话在说哪个孩子），会话创建时确定，不由模型自由指定；同一家庭多个孩子的会话、摘要、证据互不串（见 9.3）。

对话列表、摘要、证据确认、安全事件都对账号可见。归档会话保留消息（成长追溯需要），但不进入任何上下文。

---

## 15. 部署与环境变量

复用现有部署形态，不新增容器：`docker-compose.yml` 的 `api` 服务加环境变量，nginx 已有 `/api/` 与 `/family-edu/` 代理，无需改路由。

新增环境变量（写入 `.env.example` 与 `apps/api/src/env.ts`；密钥只放服务器 `.env`，不入库）：

```
TUTOR_ENABLED=false
TUTOR_CHAT_PROVIDER=
TUTOR_CHAT_API_KEY=
TUTOR_CHAT_MODEL=
TUTOR_VISION_MODEL=
TUTOR_MAX_TOOL_ROUNDS=6
TUTOR_DAILY_MESSAGE_LIMIT=60
TUTOR_DAILY_TOKEN_LIMIT=
TUTOR_CONTEXT_WINDOW_TURNS=12
MODERATION_PROVIDER=
MODERATION_API_KEY=
```

`TUTOR_ENABLED=false` 时路由返回 503 并给出可读提示，前端隐藏入口，避免半成品暴露给孩子。

---

## 16. 交付范围与实施顺序

本期目标是**一次做成完整私教**，不交付"最小可用版"：文字对话、拍图讲错题、按住说话、孩子记忆、证据回流、家长确认，都要在首发范围内。实时双向语音与输出多模态同批收尾。

内部仍然分先后做，因为有些依赖是硬的（没有会话表就跑不了对话，没有麦克风权限就录不了音）。但这属于施工顺序，不是对外分批发版：

1. 数据迁移：`TutorConversation`、`TutorMessage`、`TutorSafetyEvent`；
2. `llm/` 供应商抽象 + 实现，跑通流式；
3. `mcp-tools.ts` + `tool-policy.ts`，接只读工具；
4. `persona.ts`：由教育理念渲染人格提示词；
5. `safety.ts`：L1 + L3（L2 靠提示词）；
6. `routes.ts` + SSE，含配额；
7. 前端聊天页 + APK 端入口判定；
8. 图片上传链路；
9. `voice/` 抽象 + ASR/TTS + 按住说话；
10. 安卓补 `RECORD_AUDIO` 与 `onPermissionRequest`，发新版 APK；
11. `memory.ts`：摘要 + 证据回流（待确认）；
12. 实时语音与输出多模态。

一次做完整的代价要说在前面：**儿童语音识别准确率是唯一无法靠工程保证的环节**。ASR 选型必须用真实儿童录音实测；不达标就只能退化为"按住说话 + 文字确认"再补实时语音，这部分返工风险本期自担（见第 18 节）。

每一步结束都部署到 `heyaagent.top` 并做线上验证，不长期停留在本地。

---

## 17. 测试与验收

### 自动化

- 纯函数单测：`tool-policy` 授权表、`persona` 提示词渲染、`memory` 证据抽取与去重、`safety` 拦截分支；
- `runtime` 用假 provider 打桩，覆盖正常回答、需要工具、超出轮次上限、超时、模型报错、安全拦截替换；
- API 集成测试：家庭隔离（A 家庭 token 取不到 B 家庭会话）、配额超限、归档后不进上下文；
- 沿用 `npm run verify:web-responsive` 增加聊天页断言：三视口无横向溢出、流式占位不跳动、消息区可滚动。

### 人工验收

1. 私教讲错题时，引用的是这个孩子真实存在的错题；
2. 不给答案、先引导，符合家庭设置的严格度；
3. 孩子连续问同一题型，掌握度与练习记录随之更新；
4. 会话结束产生一条待确认证据，家长确认后进入孩子状态；
5. 换家庭账号登录，看不到另一家庭的任何会话与数据（跨家庭）；
6. **同一家庭内两个孩子各自聊天，互相看不到对方的会话、摘要与证据**（跨孩子，见 9.3，这是必测项）；
7. 让私教尝试问"另一个孩子的情况"，应被收敛，不返回兄弟姐妹的数据；
8. 拍图识别在中文手写体上可用（真实作业照片实测）；
9. 服务端无密钥泄漏：`TUTOR_CHAT_API_KEY` 只存在于服务器 `.env`。

---

## 18. 风险与未决项

| 风险 | 应对 |
|---|---|
| 儿童语音识别准确率不达标 | 上语音前用真实录音实测，不行则退化为"按住说话 + 文字确认" |
| 模型成本随使用量上涨 | 配额前置、按场景选模型、单轮工具截断 |
| 模型被诱导越界 | L1/L3 双审核 + L2 提示词硬规则 + 工具白名单默认拒绝 |
| 聊天内容变成假证据 | 证据一律 `PENDING_CONFIRMATION`，家长确认才生效 |
| 模型自主写入越界 | 工具白名单 + `childId` 由服务端注入 + 变更类工具不进对话运行时 |
| 教学理念两处漂移 | 人格每次从 `FamilyPolicy` / `EducationMethod` 渲染，不落库副本 |

需在实施时确认（本方案不假设）：

1. 对话模型与视觉模型的最终供应商、型号与计费；
2. 内容审核服务商与合规要求（本期不涉及小程序）；
3. 儿童语音数据的保存与合规边界（默认不保存原始音频）；
4. 后续是否放开网页端与小程序入口（本期只做 APK 端）。

---

## 19. 与现有系统的边界（不变更清单）

本次新增不影响：

- WorkBuddy 连接协议、`/family-edu/mcp` 路径、已提交开放平台的专家包；
- 现有 MCP 工具语义与 `docs/workbuddy-sync-spec.md`；
- 现有业务表结构（只新增三张私教表）；
- 安卓端：入口靠 UA 判定，不改 APK 即可出现；启用语音时才需要发一次新版 APK（补 `RECORD_AUDIO`）。

微信小程序本期不改，无需提审。

---

## 20. 对 WorkBuddy 对接的影响评估（2026-09-24 代码核对）

结论：**不影响。** 下面每一行都对着代码核过，不是推断。

### 20.1 逐项核对

| 可能受影响的面 | 核对结果 |
|---|---|
| MCP HTTP 链路 | `registerMcpHttp`（`apps/api/src/mcp.ts:1052`）每个请求新建 `createEducationMcpServer(familyId)` 与 `StreamableHTTPServerTransport`，`sessionIdGenerator: undefined`，即全程无状态、无共享实例（`:1078`、`:1098`） |
| 模块级状态 | `mcp.ts` 与 `mcp-token.ts` 中没有模块级 `let` / `Map` / `Set`。私教另起一个 server 实例，与 HTTP 实例之间无任何共享状态 |
| 家庭身份解析 | WorkBuddy 走 `X-MCP-Token` 或 OAuth Bearer（`:1053`、`:1059`）；私教走登录会话 `requireAuth`。两条路互不相交 |
| nginx 配置 | `/family-edu/mcp` 与 `/family-edu/` 保持原样，`/api/` 由 `location /` 覆盖。**本次不需要改 nginx** |
| 路由冲突 | 私教挂在 `/api/tutor/*`，是新增前缀，不覆盖任何现有路由 |
| 数据库 | 只新增三张私教表，无字段变更、无数据迁移。现有账号、学生、题库、作业、知识库不受影响 |
| MCP 工具契约 | 现有工具语义与参数全部不变；`get_sync_spec` 只做增量补充 |
| `EvidenceRecord.source` | 是 `String @default("workbuddy")`（`prisma/schema.prisma:904`），**不是枚举**。私教写 `source: "tutor"` 是新增取值，零 schema 变更 |
| `AuditLog.actorType` | 同为 `String`（`:1228`），同上 |
| `createEvidenceRecord` | 已接受 `actor` 参数（`apps/api/src/v2/evidence.ts:29`），默认 `workbuddy`，无需改签名 |
| 已提交开放平台的专家包 | `workbuddy-open-platform/connector/.../mcp.json` 只声明传输方式与 URL，**不含工具清单**；`SKILL.md` 与 `tool-workflows.md` 是工作流说明，不是白名单。WorkBuddy 的工具有效性是运行时 `tools/list` 动态发现的，**加工具不需要重新提审** |
| 现有测试 | 没有任何用例断言工具总数（`mcp-bootstrap.test.ts:39` 用的是 `toContain`），新增工具不会让测试变红 |

### 20.2 两处真实存在的影响（如实说明）

1. **部署会重启 api 容器**，MCP 有秒级中断。这与每次发版相同，不是本方案引入的；部署时段建议避开家长在用的时间。
2. **有一个取值刻意不动**：`update_student_question_type_mastery` 与 `update_wrong_question_status` 的 `source` 参数是封闭枚举 `["parent", "workbuddy"]`。私教不调用这两个工具（掌握度与错题状态的人工修正属于人的判断，且要家长确认），因此既不需要扩展枚举，也不需要改动 WorkBuddy 侧调用。若将来要放开，改这两处 zod 定义即可，届时 WorkBuddy 侧需同步。

### 20.3 一条需要留意的设计约束

第 4 节建议顺手补一个只读工具 `get_subject_overview`。加工具本身对 WorkBuddy 是纯增量（多一个可用工具），但**它会改动 `get_sync_spec` 的输出**，而 `get_sync_spec` 是 WorkBuddy 每次新会话读取的契约入口。改动要守两条：

- 只做增量（加 tool、加 workflow 条目），不改已有字段语义与 `enums` 取值；
- 版本号递进（当前 `2.5` → `2.6`），让 WorkBuddy 能感知规范变了。

这两条在 `docs/workbuddy-sync-spec.md` 的通用规则里已有约定，本次核对确认没有冲突。

---

## 21. 落地状态（2026-09-24）

本方案的代码已落地并跑通测试。执行目标与验收口径见 `docs/goal-tutor-agent.md`。

### 21.1 已完成

| 模块 | 位置 | 说明 |
|---|---|---|
| 数据模型 | `prisma/schema.prisma`、`prisma/migrations/20260924120000_tutor_agent/` | `TutorConversation` / `TutorMessage` / `TutorSafetyEvent` 三张表，纯新增 |
| 孩子维度教育方式 | `prisma/migrations/20260924090000_child_skill_profile/`、`apps/api/src/personalization.ts`、`apps/api/src/v2/guards.ts` | `ChildSkillProfile` 三层解析（全局技能 → 家庭策略 → 孩子级调整），`assertChildInFamily` 统一守卫 |
| 模型接入 | `apps/api/src/tutor/llm/` | `ChatProvider` 抽象 + 豆包 OpenAI 兼容流式实现（SSE 缓冲、工具调用分片拼接）+ 测试用 `FakeChatProvider` |
| 工具接入 | `apps/api/src/tutor/mcp-tools.ts`、`tool-policy.ts` | 进程内 MCP 客户端（`InMemoryTransport.createLinkedPair()`）；工具授权表默认拒绝 |
| 人格渲染 | `apps/api/src/tutor/persona.ts` | 纯函数 `renderTutorPrompt` + 取数 `buildTutorPersona`，含 L2 五条硬规则 |
| 内容安全 | `apps/api/src/tutor/safety.ts` | L1 输入侧、L3 输出侧、引用校验、`TutorSafetyEvent` 记账 |
| 运行时 | `apps/api/src/tutor/runtime.ts`、`quota.ts` | 轮次上限 / 单轮超时 / 工具结果截断；每日配额 |
| 记忆 | `apps/api/src/tutor/memory.ts` | 短期窗口 + 会话摘要 + 证据回流（去重，一律 `PENDING_CONFIRMATION`） |
| 接口 | `apps/api/src/tutor/routes.ts` | `/api/tutor/*`，含 SSE、附件、证据、语音 |
| 语音 | `apps/api/src/tutor/voice/` | ASR/TTS 抽象 + 火山引擎适配（协议待用真实凭据核实） |
| 前端 | `apps/web/src/components/TutorChat.tsx`、`lib/tutor.ts`、`Layout.tsx` | APK 端入口判定（UA `HeYaAndroid`）、SSE 客户端；桌面与小程序不显示入口 |
| 安卓 | `android/.../AndroidManifest.xml`、`MainActivity.java` | `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS`，`onPermissionRequest` 转系统授权 |
| MCP 增量 | `apps/api/src/v2/mcp-tools.ts`、`apps/api/src/mcp.ts` | 新增只读工具 `get_subject_overview`；`get_sync_spec` 升到 `2.7`（新增 `subject_overview`、`education_style`、`child_dimension_rule`） |
| 开放平台包 | `workbuddy-open-platform/` | Connector 2.3.0 / Expert 1.7.0 / Skill 2.7.0，`check:workbuddy` 与 `package:workbuddy` 通过 |

### 21.2 验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| API 单测（含私教 79 条） | `npm test` | 33 文件 210 用例全部通过 |
| 小程序校验 | `npm run check:miniprogram` | 19 页 / 21 json / 28 js / 19 wxml / 20 wxss 通过 |
| 前端构建 | `npm run build` | 构建成功 |
| 响应式与入口可见性 | `npm run verify:web-responsive` | 4 个形态（平板横屏 / 平板竖屏 / 手机 / 安卓 WebView）：无横向溢出；私教入口只在安卓 UA 下出现；聊天页可输入、发送键不越界；首页四学科与空状态正常 |
| 迁移与模型一致 | `prisma validate` + 逐表比对 | 三张私教表与 `ChildSkillProfile` 的字段、索引与 migration 完全一致 |
| WorkBuddy 包 | `npm run check:workbuddy`、`npm run package:workbuddy` | 校验通过并生成三个可提审 ZIP |

### 21.3 执行中修正的一处行为

`assertChildInFamily` 原先抛普通 `Error`，客户端传了不属于本家庭的 `child_id` 会返回 500。已改为带 `statusCode: 404` 的错误
（Fastify 5 默认错误处理会采用该状态码），把客户端错误与服务器故障区分开。`routes.test.ts` 覆盖了跨家庭读会话、跨家庭读孩子两个方向。

### 21.4 仍需真实凭据才能完成的收尾

以下三项**不影响开发与自动化测试**（全部用假 provider 打桩），但线上真机验证前必须由 jojo 提供：

1. 豆包 API Key，以及对话模型与视觉模型的接入点（Endpoint ID）或模型名；
2. 火山「语音技术」是否已开通 —— 识别与合成各需 App ID / Access Token（协议实现已按火山文档写好，待真实凭据核实）；
3. 每日配额默认值与儿童语音原始音频是否留存（当前默认：每孩子 60 条消息、不留存原始音频）。

在拿到凭据前，`TUTOR_ENABLED` 保持关闭：接口返回 503，前端隐藏入口，线上行为与上线前一致。
