# 禾芽家庭 AI 教育

禾芽以 WorkBuddy / 豆包工作作为 Agent 对话与执行入口，项目本身提供家庭教育知识、学生长期数据、家庭专属 MCP、家长 Web/小程序管理端，以及安卓端内置的学习私教。

生产架构：TypeScript + Fastify + Prisma + PostgreSQL 16 + React/Vite + Tailwind CSS + 腾讯云 COS。

## 已实现能力

- 微信授权登录，登录页保留“邮箱登录”小入口供早期邮箱账号使用；首个家长创建家庭或申请加入已有家庭，6 位家庭编码 + 创建者审核；
- 单家庭多学生档案，多家长共用同一家庭，OAuth 授权按家庭隔离数据；
- 孩子结构化证据、当前状态、亲子关系、阶段目标、周计划和复测；
- 教材、知识节点、题库、错题、作业和成长报告；
- 家庭边界、教育方法库和方法效果记录；
- 教材知识节点支持掌握证据、评估问句、常见错误和 hard/soft 前置关系；
- WorkBuddy / 豆包工作录题、生成变式练习、同步作答与查询掌握度；
- 学生错题本、严格掌握证据、针对性练习试卷和错题教学规划；
- 明亮学堂 Web 管理端，支持桌面端和手机端。
- 微信小程序家长端，支持微信一键登录、家庭编码与加入申请审核。
- WorkBuddy 开放平台 Connector、Skill、Expert 提交包，使用 MCP OAuth 2.1 + PKCE：首次连接自动打开禾芽授权网页，微信扫码选择家庭即可，不需要复制 Token。
- 安卓平板 / 手机客户端（一个 APK 通吃，微信扫码登录，带原生下拉刷新与断网重试），详见 [安卓客户端文档](docs/android-app.md)。
- **内置学习私教**（Education Agent Layer）：安卓 APK 内可对话的桌面端私教，支持流式回答、拍图讲错题、按住说话、孩子记忆、证据回流与家长确认；人格按孩子维度解析（全局技能 → 家庭策略 → 孩子级调整），与 WorkBuddy 共用同一份数据。见 [内置学习私教](docs/TUTOR_AGENT_DESIGN.md)。

## 本地启动

```bash
cd /Users/nightwf/Desktop/儿童AI教育/family-edu-agent
npm install
docker compose up -d --build
```

打开 `http://localhost:4100/family-edu/`。正式环境不预置演示账号或假数据。

## 微信小程序

小程序源码位于 `miniprogram/`，导入微信开发者工具即可调试。详细说明见 [小程序接入文档](docs/miniprogram.md)。

```text
登录：微信一键登录；首次登录创建家庭，或输入 6 位家庭编码申请加入；底部可展开邮箱登录
首页：孩子当前状态、亲子关系、本周重点、最近动态
学生：新建、编辑、删除学生档案
成长：成长记录、报告、成长轨迹
学习：题库、错题本、教材、作业、知识库
我的：家庭编码、加入申请审核、已连接的 WorkBuddy、家庭边界、教育方法库
```

微信登录需要后端配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`；小程序正式版还需要配置 HTTPS 请求合法域名。

## 常用命令

```bash
npm run build         # 构建 Web
npm run test          # 全部单元测试
npm run test:e2e      # Playwright 端到端测试
npm run test:mcp      # MCP 握手检查，需要 MCP_SMOKE_TOKEN
npm run check:workbuddy   # 检查开放平台 Connector / Expert 包
npm run package:workbuddy # 生成可上传开放平台的 ZIP
npm run db:generate   # 生成 Prisma Client
npm run db:deploy     # 执行增量 migration
```

## 核心 API

除注册、登录和健康检查外，Web API 均需 `Authorization: Bearer <token>`。

```text
POST   /api/auth/register
POST   /api/auth/login
GET    /api/home
GET    /api/children
GET    /api/textbooks
GET    /api/homework
GET    /api/knowledge

GET    /api/question-types
POST   /api/question-types
GET    /api/question-types/:questionTypeId
PATCH  /api/question-types/:questionTypeId
DELETE /api/question-types/:questionTypeId

GET    /api/questions
POST   /api/questions
POST   /api/questions/batch
POST   /api/questions/upload
GET    /api/questions/:questionId
PATCH  /api/questions/:questionId
DELETE /api/questions/:questionId

POST   /api/question-generation-context
GET    /api/question-attempts
POST   /api/question-attempts
GET    /api/mastery
PATCH  /api/mastery/:childId/:questionTypeId
POST   /api/mastery/:childId/:questionTypeId/recalculate

GET    /api/wrong-questions
POST   /api/wrong-questions
GET    /api/wrong-questions/:wrongQuestionId
PATCH  /api/wrong-questions/:wrongQuestionId/status
POST   /api/wrong-questions/:wrongQuestionId/recalculate

GET    /api/practice-papers
POST   /api/practice-papers
GET    /api/practice-papers/:practicePaperId

GET    /api/remediation-plans
POST   /api/remediation-plans
PATCH  /api/remediation-plans/:planId/tasks/:taskId/status

GET    /api/tutor/status
GET    /api/tutor/quota
GET    /api/tutor/conversations
POST   /api/tutor/conversations
GET    /api/tutor/conversations/:conversationId/messages
POST   /api/tutor/conversations/:conversationId/messages   # SSE 流式
POST   /api/tutor/conversations/:conversationId/attachments
POST   /api/tutor/conversations/:conversationId/evidence
POST   /api/tutor/conversations/:conversationId/interrupt   # 孩子插话，停掉正在生成的一轮
GET    /api/tutor/conversations/:conversationId/worksheet   # 可打印讲义（text/html）
DELETE /api/tutor/conversations/:conversationId
GET    /api/tutor/voice/status
POST   /api/tutor/voice/transcribe
POST   /api/tutor/voice/speak
```

私教接口只从登录会话推导 `familyId`，不接受客户端传入；`childId` 在会话创建时固定，运行时覆盖模型传入的值。
`TUTOR_ENABLED=false` 时全部返回 503，前端同时隐藏入口。模型与语音凭据只写在服务器 `.env`（`TUTOR_*`）。
`worksheet` 只把这段对话的真实文本排成可打印 HTML，不引入自由生图，页脚标注"证据需家长确认"。

语音分三级台阶：按住说话（A）、免录制的连续对话（B）、可随时打断的实时对话（C）。
B 与 C 的断句在浏览器本地完成，故意不传音频流：打断只需要一个 `interrupt` 请求，
音频仍按句走既有链路，避免把厂商凭据下发到前端。发消息时带 `speak: true`，
回答会按句合成并通过 SSE 的 `speech` 事件边到边念。

## WorkBuddy / 豆包工作接入

推荐方式：在 WorkBuddy 开放平台安装“禾芽家庭教务”连接器或召唤“禾芽家庭私教”Expert，点击连接后 WorkBuddy 会自动打开禾芽授权网页并显示微信小程序码；家长扫码选择家庭并确认授权即可。新会话由 Agent 自动调用 `get_agent_bootstrap` 获取学生、能力范围和启动规则，不需要家长粘贴 Token 或提示词。

Web 与小程序设置页仍提供豆包工作备用提示词，供豆包工作这类暂不支持扫码授权的入口使用；WorkBuddy 本身不再需要手工 Token。详细提交方式见 [WorkBuddy 开放平台接入](docs/workbuddy-open-platform.md)。

远程 MCP 地址：`https://heyaagent.top/family-edu/mcp`。OAuth 元数据位于 `/.well-known/oauth-protected-resource` 与 `/.well-known/oauth-authorization-server`，未授权请求返回 401 并附带 `WWW-Authenticate`。家庭身份只由连接授权决定，MCP 参数中的资源 ID 还会再次校验家庭归属。过渡期内仍兼容旧的 `X-MCP-Token` 请求头，已连接的旧客户端不会立刻中断。

题库工作流：

```text
list_question_types
  -> create_question_type（必要时）
  -> save_question / save_questions_batch
  -> get_question_generation_context
  -> WorkBuddy 生成变式练习
  -> record_question_attempt
  -> get_student_question_type_mastery
```

错题学习工作流：

```text
record_question_attempt(save_to_wrong_book=true)
  -> get_wrong_question_practice_context
  -> save_questions_batch
  -> create_practice_paper
  -> record_question_attempt(wrong_question_id + practice_paper_id)
  -> recalculate_wrong_question_mastery
  -> save_remediation_plan（需要教学规划时）
```

错题单次订正不会自动进入“已掌握”。默认还需 3 道独立正确变式、2 次练习会话、迁移题和 24 小时后复测。完整 MCP 参数见 [MCP 工具说明](docs/MCP.md)。

## 项目结构

```text
apps/api/src/                 Fastify API、MCP 和领域服务
apps/web/src/                 React 家长管理端
miniprogram/                  微信小程序家长端
prisma/schema.prisma          PostgreSQL 数据模型
prisma/migrations/            增量数据库迁移
skills/                       全局教育 Skill 库
docs/                         架构、同步、存储与备份说明
deploy/                       腾讯云独立部署配置
```

更多说明见 [技术架构](docs/ARCHITECTURE.md)、[WorkBuddy 同步规范](docs/workbuddy-sync-spec.md)、[内置学习私教](docs/TUTOR_AGENT_DESIGN.md)（含与 WorkBuddy 的分工边界、落地状态与验收口径）和 [教育方式按孩子维度分层](docs/CHILD_SCOPED_EDUCATION_DESIGN.md)（同一家庭不同孩子可以有各自的教育方式）。

模型与语音凭据的开通步骤见 [豆包与火山语音开通清单](docs/doubao-setup.md)；拿到 Key 后用 `npm run check:doubao` 自检（会报出哪些模型 ID 真的能调、是否支持工具调用，并给出该写入 `.env` 的值），再用 `bash scripts/enable-tutor.sh --key=xxx --chat-model=xxx` 一条命令完成验证、配置、重启与线上对话校验。

私教相关的环境变量集中在服务器 `.env`（见 `apps/api/src/env.ts` 的 `TUTOR_*`）：

> 这些变量同时列在 `docker-compose.yml` 的 `environment:` 段里才会进入容器；那一段是白名单，只改 `.env` 不生效。

| 变量 | 用途 |
| --- | --- |
| `TUTOR_ENABLED` | 总开关，关闭时接口返回 503 且前端隐藏入口 |
| `TUTOR_CHAT_API_KEY` / `TUTOR_CHAT_BASE_URL` / `TUTOR_CHAT_MODEL` | 豆包（火山方舟）对话模型，默认接入点 `ark.cn-beijing.volces.com/api/v3` |
| `TUTOR_VISION_MODEL` | 拍图识题用的视觉模型 |
| `TUTOR_ASR_API_KEY` / `TUTOR_ASR_RESOURCE_ID` | 语音识别（火山「语音技术」单独开通）。新版控制台一把 API Key 即可，资源标识默认 `volc.bigasr.auc_turbo` |
| `TUTOR_TTS_API_KEY` / `TUTOR_TTS_SPEAKER` / `TUTOR_TTS_RESOURCE_ID` | 语音合成，Key 与识别共用同一把，`TUTOR_TTS_SPEAKER` 填控制台音色 ID，资源标识默认 `seed-tts-2.0` |
| `TUTOR_ASR_APP_ID` / `TUTOR_ASR_ACCESS_TOKEN` / `TUTOR_ASR_CLUSTER` / `TUTOR_TTS_APP_ID` / `TUTOR_TTS_ACCESS_TOKEN` / `TUTOR_TTS_CLUSTER` / `TUTOR_TTS_VOICE_TYPE` | 旧版控制台的三件套回退路径，新版 API Key 到位后不需要填 |
| `TUTOR_DAILY_MESSAGE_LIMIT` / `TUTOR_DAILY_TOKEN_LIMIT` | 配额：每孩子每日消息数（默认 60）与 token 上限（0 = 不单独限制） |
| `TUTOR_VOICE_IDLE_MS` | 连续对话（免提）静默多久自动关麦克风，默认 180000（3 分钟）。连续对话期间麦克风是常开的（插话打断靠它），孩子放下就走时靠它兜底；填 0 表示一直听 |
| `TUTOR_MAX_TOOL_ROUNDS` / `TUTOR_REQUEST_TIMEOUT_MS` / `TUTOR_TOOL_RESULT_LIMIT` | 单轮工具调用上限（6 轮）、超时（45 秒）、工具结果截断（6KB） |
| `TUTOR_CONTEXT_WINDOW_TURNS` / `TUTOR_MODERATION_ENABLED` | 上下文窗口轮数（12）与内容审核开关 |
