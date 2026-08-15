# 家庭 AI 教育 Agent MVP

基于 PRD V1.1 的可运行第一版：云端业务服务 + Family Education MCP + 明亮学堂风格 Web 管理端。

产品定位：WorkBuddy 负责 AI 对话和生成总结、报告、任务建议；本项目负责通过 MCP 接收这些结果，沉淀为家庭长期知识库，并在 Web 端展示和管理。MVP 主要提供数据查看与基础设置，不承载独立聊天或 AI 生成。

## 快速启动

```bash
cd /Users/nightwf/Desktop/儿童AI教育/family-edu-agent
npm install
npm run seed
npm start
```

打开 `http://localhost:4100`。

演示账号：

```text
邮箱：jojo@example.com
密码：123456
```

演示邀请码：

```text
HE-2026
```

## 已实现功能

- 邀请码注册、邮箱密码登录、退出登录；
- 首页、学生、报告成长、教材、作业、知识库、账号与设置七个管理端页面；
- 创建孩子、通过 WorkBuddy 导入教材、本地兜底上传、编辑教材元数据；
- 周报 / 月报生成、成长轨迹趋势图；
- WorkBuddy 生成总结、报告和建议的知识库查看；
- WorkBuddy 识别家庭作业、同步完成状态，后台管理每日作业；
- WorkBuddy 连接提示词查看和复制；
- WorkBuddy 同步规范（可通过 `get_sync_spec` 主动读取）；
- 项目内置教育 Skill 库：写作、阅读、作业、家长教练、成长分析；
- MCP 教育专家工具：`list_education_skills`、`get_education_skill`、`get_child_context`、`get_coaching_policy`；
- 本地 MCP + 云端同步兜底接口；
- 四种后台风格预览，默认明亮学堂。

## 常用命令

```bash
npm start        # 启动业务服务与 Web 管理端
npm run dev      # 文件变化后自动重启
npm run mcp      # 启动 Family Education MCP（stdio）
npm run seed     # 生成演示数据
npm test         # 运行数据层测试
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
