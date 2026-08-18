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
- 明亮学堂 Web 管理端，支持桌面端和手机端。

## 本地启动

```bash
cd /Users/nightwf/Desktop/儿童AI教育/family-edu-agent
npm install
docker compose up -d --build
```

打开 `http://localhost:4100/family-edu/`。正式环境不预置演示账号或假数据。

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

## 项目结构

```text
apps/api/src/                 Fastify API、MCP 和领域服务
apps/web/src/                 React 家长管理端
prisma/schema.prisma          PostgreSQL 数据模型
prisma/migrations/            增量数据库迁移
skills/                       全局教育 Skill 库
docs/                         架构、同步、存储与备份说明
deploy/                       腾讯云独立部署配置
```

更多说明见 [技术架构](docs/ARCHITECTURE.md) 和 [WorkBuddy 同步规范](docs/workbuddy-sync-spec.md)。
