# 技术架构

WorkBuddy 负责 AI 理解、对话、讲解和出题；Family Education MCP 提供教育规则与受控数据工具；本项目保存家庭长期数据，并通过 Web 管理端供家长查看和管理。开放平台将同一套能力包装为 Connector + Skill + Expert，不新建第二套 MCP。

```text
WorkBuddy
   │ 禾芽家庭私教 Expert + 禾芽教育 Skill
   │ Streamable HTTP MCP + 家庭专属 Token
   ▼
Fastify API / Family Education MCP
   ├── 家庭认证与资源归属校验
   ├── Education Skills / 家庭教育方式
   ├── 成长、报告、教材、作业、知识库
   └── 题库、错题、答题证据、练习试卷、教学规划与掌握度
   │
   ├── PostgreSQL 16（结构化数据）
   └── 腾讯云 COS / MinIO（教材和题目附件）
   ▲
React Web 家长管理端 / 微信小程序
```

## 数据边界

- `Family` 是租户边界，一个注册账号对应一个家庭；
- Web API 从登录 JWT 获取 `familyId`；
- MCP 从 `X-MCP-Token` 获取 `familyId`，忽略调用方提供的家庭编号；
- 所有学生和资源 ID 在读写前再次校验属于当前家庭；
- 开放平台包只保存 `${HEYA_FAMILY_TOKEN}` 占位符，用户填写的 Token 由 WorkBuddy 本机保管；
- 题目属于家庭，可供家庭内多个学生复用；
- 作答和掌握度属于“学生 + 题型”，不同学生互不影响。

微信小程序复用同一套 JWT 与家庭隔离规则。微信登录由后端调用微信 `jscode2session` 获取 openid，并绑定到 `User`；小程序只负责展示与请求，不直接处理 openid。
- 错题属于“学生 + 题目”，同一学生同一题唯一；重复出错累计次数，不生成重复条目；
- 试卷和教学规划只引用家庭内资源，删除组织对象不删除题库原题或历史作答。

## 数据模型

基础模型：`Family`、`User`、`Child`、`Session`、`McpToken`。

教育数据：`Record`、`Report`、`Textbook`、`Homework`、`KnowledgeItem`。

教育方式：`SkillVersion`、`FamilySkillProfile`、`SkillOverride`、`PolicyChange`。

题库模型：

- `QuestionType`：题型分类、解题结构、生成规则、答案校验和掌握标准；
- `Question`：家庭可复用题目、答案、解析、附件及规则版本；
- `QuestionAttempt`：学生每次真实作答及错误证据；
- `StudentQuestionTypeMastery`：学生对题型的自动判断、人工修正和复习安排。

错题教学模型：

- `WrongQuestionEntry`：一名学生的一道错题、错误诊断、状态、掌握分、复习安排与人工修正；
- `PracticePaper` / `PracticePaperQuestion`：针对性试卷及题目顺序、分值、训练目的和来源错题；
- `RemediationPlan` / `RemediationTask`：错题诊断后的教学规划、阶段任务和完成证据；
- `QuestionAttempt` 扩展关联错题和试卷，并记录原题订正、独立作答、变式类型和练习会话。

## 掌握度

自动掌握分由正确率、独立作答、变式覆盖、迁移题和延迟复测组成。默认达到 80 分、至少 5 次有效练习、3 种变式，并通过迁移题和 24 小时后的复测才可标记“已掌握”。人工调整必须保留原因和来源，自动重算不会覆盖人工结论。

错题掌握采用更严格的独立证据：原题订正通过、至少 3 道不同的独立正确变式、至少 2 次练习会话、迁移题通过、24 小时后延迟复测通过且掌握分达到 80。单次正确只能进入巩固过程；已掌握后再次答错自动转为“需复习”。错题重算同时重算对应题型掌握度，但不会直接强制题型进入已掌握。

## 同题型生成

项目不直接调用大模型出题。`get_question_generation_context` 向 WorkBuddy 返回题型不变量、可变参数、难度阶梯、学生薄弱点、答案校验和标准输出格式。WorkBuddy 生成后通过 `save_questions_batch` 写回。

错题变式使用 `get_wrong_question_practice_context`，在题型规则基础上增加原始错误、当前错题证据、未覆盖变式和目标难度。WorkBuddy 生成题目后先写入题库，再组成 `PracticePaper`；系统不保存无法验证答案或未写回题库的临时题目。

题目统一通过 WorkBuddy 和家庭专属 MCP 录入。Web 管理端不提供手工新建题目，只负责查看、修正元数据、停用、删除和掌握证据回溯。

## 部署

服务通过 Docker Compose 独立运行 PostgreSQL、API 和 MinIO，API 仅监听 `127.0.0.1:4100`。Nginx 只代理 `/family-edu/`，不修改服务器其他站点。容器启动时先执行 `prisma migrate deploy`，然后启动 Fastify。

错题本使用 `20260818160000_wrong_book` 增量迁移，不清空现有家庭、账号和业务数据。部署前必须先运行数据库备份，迁移失败时停止 API 更新并保留原容器。

## WorkBuddy 开放平台

- Connector：一个远程 `streamableHttp` MCP，使用本机 Token 表单注入 `X-MCP-Token`；
- Skill：定义学生选择、上下文读取、计划、作业、错题、掌握度和写回边界；
- Expert：提供“禾芽家庭私教”入口，并声明 MCP 依赖；
- `get_agent_bootstrap`：新会话一次读取家庭学生、数据概况、任务路由和安全规则；
- `get_sync_spec`：复杂任务或工具变化时读取详细同步规范。

公开分发初期使用 Token 模式；用户规模扩大后升级 OAuth 2.1 + PKCE，替代复制 Token 的授权体验。
