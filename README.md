# 禾芽家庭 AI 教育

禾芽以 WorkBuddy 作为 Agent 对话与执行入口，项目本身提供家庭教育知识、题库规则、学生长期数据、家庭专属 MCP 和家长 Web 管理端。

生产架构：TypeScript + Fastify + Prisma + PostgreSQL 16 + React/Vite + Tailwind CSS + 腾讯云 COS。

## 已实现能力

- 邀请码注册、邮箱密码登录和会话管理；
- 单家庭多学生档案，家庭专属 MCP Token 隔离数据；
- 成长记录、报告、教材、作业和知识库；
- 家庭级教育理念、沟通方式和教育方法推荐；
- 家庭题库、题型生成规则、学生作答证据和题型掌握度；
- WorkBuddy 录题、生成变式练习、同步作答与查询掌握度；
- 学生错题本、严格掌握证据、针对性练习试卷和错题教学规划；
- 明亮学堂 Web 管理端，支持桌面端和手机端。
- 微信小程序家长端，支持微信一键登录和家庭专属 WorkBuddy 提示词。

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
登录：邮箱密码 / 邀请码注册 / 微信一键登录
首页：家庭概览、孩子、最近报告
学生：新建、编辑、删除学生档案
成长：成长记录、报告、成长轨迹
学习：题库、错题本、教材、作业、知识库
我的：账号、微信绑定、WorkBuddy 提示词、教育方式
```

微信登录需要后端配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`；小程序正式版还需要配置 HTTPS 请求合法域名。

## 常用命令

```bash
npm run build         # 构建 Web
npm run test          # 全部单元测试
npm run test:e2e      # Playwright 端到端测试
npm run test:mcp      # MCP 握手检查，需要 MCP_SMOKE_TOKEN
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
```

## WorkBuddy 接入

1. 登录管理端并进入“设置”；
2. 复制完整 WorkBuddy 连接提示词，其中包含家庭专属 Token；
3. 在 WorkBuddy 配置同一个 `family-edu-mcp`；
4. 首次使用时让 WorkBuddy 调用 `get_sync_spec` 读取最新版规范。

远程 MCP 地址：`http://49.234.4.212/family-edu/mcp`，请求头为 `X-MCP-Token: <家庭专属 token>`。家庭身份只由 Token 决定，MCP 参数中的资源 ID 还会再次校验家庭归属。

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

更多说明见 [技术架构](docs/ARCHITECTURE.md) 和 [WorkBuddy 同步规范](docs/workbuddy-sync-spec.md)。
