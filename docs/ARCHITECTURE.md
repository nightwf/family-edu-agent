# 技术架构

WorkBuddy 负责 AI 理解、对话、讲解和出题；Family Education MCP 提供教育规则与受控数据工具；本项目保存家庭长期数据，并通过 Web 管理端供家长查看和管理。

```text
WorkBuddy
   │ Streamable HTTP MCP + 家庭专属 Token
   ▼
Fastify API / Family Education MCP
   ├── 家庭认证与资源归属校验
   ├── Education Skills / 家庭教育方式
   ├── 成长、报告、教材、作业、知识库
   └── 题库、题型规则、答题证据、掌握度
   │
   ├── PostgreSQL 16（结构化数据）
   └── 腾讯云 COS / MinIO（教材和题目附件）
   ▲
React Web 家长管理端
```

## 数据边界

- `Family` 是租户边界，一个注册账号对应一个家庭；
- Web API 从登录 JWT 获取 `familyId`；
- MCP 从 `X-MCP-Token` 获取 `familyId`，忽略调用方提供的家庭编号；
- 所有学生和资源 ID 在读写前再次校验属于当前家庭；
- 题目属于家庭，可供家庭内多个学生复用；
- 作答和掌握度属于“学生 + 题型”，不同学生互不影响。

## 数据模型

基础模型：`Family`、`User`、`Child`、`Session`、`McpToken`。

教育数据：`Record`、`Report`、`Textbook`、`Homework`、`KnowledgeItem`。

教育方式：`SkillVersion`、`FamilySkillProfile`、`SkillOverride`、`PolicyChange`。

题库模型：

- `QuestionType`：题型分类、解题结构、生成规则、答案校验和掌握标准；
- `Question`：家庭可复用题目、答案、解析、附件及规则版本；
- `QuestionAttempt`：学生每次真实作答及错误证据；
- `StudentQuestionTypeMastery`：学生对题型的自动判断、人工修正和复习安排。

## 掌握度

自动掌握分由正确率、独立作答、变式覆盖、迁移题和延迟复测组成。默认达到 80 分、至少 5 次有效练习、3 种变式，并通过迁移题和 24 小时后的复测才可标记“已掌握”。人工调整必须保留原因和来源，自动重算不会覆盖人工结论。

## 同题型生成

项目不直接调用大模型出题。`get_question_generation_context` 向 WorkBuddy 返回题型不变量、可变参数、难度阶梯、学生薄弱点、答案校验和标准输出格式。WorkBuddy 生成后通过 `save_questions_batch` 写回。

## 部署

服务通过 Docker Compose 独立运行 PostgreSQL、API 和 MinIO，API 仅监听 `127.0.0.1:4100`。Nginx 只代理 `/family-edu/`，不修改服务器其他站点。容器启动时先执行 `prisma migrate deploy`，然后启动 Fastify。
