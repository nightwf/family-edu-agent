# 家庭 AI 教育 Agent MVP

基于最终生产架构的 TypeScript 重构：Fastify API + Prisma + PostgreSQL + React Web + Family Education MCP。

职责定位：WorkBuddy 负责 Agent 运行和对话，项目负责教育知识库、教育 Skill、孩子成长数据和数据持久化，Web 端负责家长查看与管理。

## 快速启动

```bash
cd /Users/nightwf/Desktop/儿童AI教育/family-edu-agent
npm install
docker compose up -d --build
```

打开 `http://localhost:4100/family-edu/`。

正式环境通过邀请码注册，不预置演示账号。

## 已实现功能

- 邀请码注册、邮箱密码登录、Refresh Token 会话管理；
- PostgreSQL 存储家庭、孩子、记录、报告、教材、作业和知识库；
- React Web 七个管理端页面；
- 教育 Skill 库和 MCP 教育专家工具；
- 家庭级个性化教育方式：教育理念、沟通风格、严格程度、家长目标；
- 教育方式优化建议与历史记录，支持采纳或忽略；
- HTTP MCP 鉴权和家庭数据隔离；
- Docker Compose 一键部署。

## 常用命令

```bash
npm run dev           # 启动 API 开发服务
npm run build         # 构建 Web 前端
npm test              # 运行测试
npm run db:migrate    # 创建本地数据库 migration
npm run db:deploy     # 执行数据库 migration
```

同步规范见 [docs/workbuddy-sync-spec.md](docs/workbuddy-sync-spec.md)。

教育 Skill 库位于 `skills/`，每个 `skill.md` 包含适用年龄、使用场景、执行流程、提问方式、评价标准、禁忌、输出格式和数据写入规则。

## API

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/home
GET  /api/children
POST /api/children
PATCH /api/children/:childId
DELETE /api/children/:childId
GET  /api/children/:childId/reports
POST /api/children/:childId/reports
GET  /api/children/:childId/growth
GET  /api/textbooks
POST /api/textbooks/import
PATCH /api/textbooks/:textbookId
DELETE /api/textbooks/:textbookId
GET  /api/knowledge
POST /api/knowledge
DELETE /api/knowledge/:itemId
GET  /api/homework
POST /api/homework
PATCH /api/homework/:homeworkId
POST /api/homework/:homeworkId/complete
POST /api/sync/local
GET  /api/settings
```

除注册、登录、健康检查外，接口都需要 `Authorization: Bearer <token>`。

## WorkBuddy 接入

1. 登录管理端后进入“设置”；
2. 复制 WorkBuddy 连接提示词；
3. 在 WorkBuddy 中新建自定义助手，把提示词粘贴到助手说明；
4. 将 `family-edu-mcp` 接入助手。

远程 MCP 可用时直接连接 `http://49.234.4.212/family-edu/mcp`；如果 WorkBuddy 当前不支持远程 MCP，可使用本地 MCP：

```bash
npm run mcp
```

本地 MCP 产生的数据可通过 `POST /api/sync/local` 同步到云端业务服务。

## 项目结构

```text
family-edu-agent/
├── apps/web/index.html       # 明亮学堂 Web 管理端
├── src/api.js                # 云端业务服务
├── src/store.js              # 数据模型与业务逻辑
├── src/mcp/server.js         # Family Education MCP 工具
├── src/mcp/standalone.js     # MCP stdio 启动入口
├── data/db.json              # MVP JSON 数据（运行后生成）
├── tests/store.test.js       # 数据层测试
└── README.md
```

## 范围说明

MVP 暂不做支付、手机 App、内置教材库、向量数据库和孩子登录。数据层使用 JSON 文件便于本地运行和备份，接口与数据模型已按云端 PostgreSQL + 对象存储方向抽象。
