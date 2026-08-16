# 技术架构

WorkBuddy 负责 AI 理解、对话和生成；Family Education MCP 负责把记录、总结、报告、教材和任务写入业务服务；本项目作为家庭长期知识库和展示管理端，面向家长提供查看、回溯和基础设置能力。

教育能力由项目内置的 `skills/` 教育 Skill 库提供。WorkBuddy 处理教育问题前，应先通过 `get_child_context` 获取孩子上下文，再通过 `get_education_skill` 获取对应教育方法。

```text
WorkBuddy
   │ MCP HTTP + Token
   ▼
Fastify API / Family Education MCP
   │
   ├── Education Domain
   ├── 认证与家庭隔离
   ├── 成长记录与报告
   ├── 教材与作业
   └── 知识库
   │
   ├── PostgreSQL 16
   └── MinIO / 腾讯云 COS
```

## 数据模型

- Family：一个家庭账号，使用邀请码注册；
- User：邮箱 + 密码登录；
- Child：孩子档案，包含年龄、年级、学科、教材版本；
- Record：作文、阅读、作业、家长笔记等成长记录；
- Report：周报 / 月报；
- Textbook：WorkBuddy 上传的教材，包含章节和知识点；
- Homework：家庭作业；
- KnowledgeItem：WorkBuddy 生成并同步到项目的总结、报告和建议；
- Session：Refresh Token 会话。
- SkillVersion：全局基础 Skill 的版本记录；
- FamilySkillProfile：家庭级教育方式配置；
- SkillOverride：家庭对基础 Skill 的受控覆盖；
- PolicyChange：教育方式调整、建议和审核历史。

## MCP 工具

Family Education MCP 提供 `get_child_profile`、`save_writing_record`、`analyze_writing_progress`、`save_knowledge_item`、`list_knowledge_items`、`save_homework`、`complete_homework`、`import_textbook`、`update_textbook` 等工具，完整清单见 PRD V1.1 第 23 节。

教育 Skill 库位于 `skills/`，包含写作教练、阅读教练、作业规划、家长教练和成长分析五个标准 `skill.md`。

## 同步兜底

业务服务同时暴露 HTTP MCP 入口 `/mcp`，通过 `X-MCP-Token` 鉴权。Web 管理端由 Fastify 静态托管，使用 `/family-edu/` 子路径对外提供。

部署使用 Docker Compose：PostgreSQL、API、MinIO 三个容器。数据库备份脚本见 `deploy/backup.sh`。
