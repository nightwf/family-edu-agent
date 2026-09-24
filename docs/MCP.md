# Family Education MCP 工具说明

MCP 地址为 `https://heyaagent.top/family-edu/mcp`。每个家庭使用独立 `X-MCP-Token`，服务端只从 Token 获取 `familyId`，所有资源 ID 还会再次校验家庭归属。

## Agent 启动工具

| 工具 | 用途 |
| --- | --- |
| `get_agent_bootstrap` | 新会话首次使用禾芽时调用，返回当前家庭的学生列表、数据概况、任务路由和安全边界 |
| `get_sync_spec` | 工具变化、复杂同步或不确定写入范围时读取详细规范 |

开放平台 Expert 和 Skill 会先调用 `get_agent_bootstrap`，不要求家长每次重新粘贴完整提示词。

## 教育方式工具（按孩子维度）

同一个家庭的不同孩子可以有各自的教育方式。解析顺序是「全局基础技能 → 家庭策略 → 孩子级调整」，孩子级字段为空时逐项继承家庭设置。

| 工具 | 关键参数 | 用途 |
| --- | --- | --- |
| `list_education_skills` | 无 | 读取内置教育 Skill 列表 |
| `get_effective_skill` | `skill_id`、可选 `child_id` | 读取最终生效的教育 Skill。**传 `child_id` 才会应用孩子级配置**；不传时只按家庭策略返回，行为与历史版本一致 |
| `list_family_policies` | 可选 `child_id` | 读取家庭级配置；传 `child_id` 时附带该孩子的个体配置与合并结果 |
| `update_family_policy` | `skill_id`、可选 `child_id` | 不传 `child_id` 写家庭级；传了写这个孩子的个体配置 |
| `get_child_education_profile` | `child_id` | 读取该孩子各教育场景的个体配置、家庭继承值和最终生效设置 |
| `update_child_education_profile` | `child_id`、`skill_id`、可选 `philosophy` / `communication_style` / `strictness` / `parent_goals` / `notes` / `clear` | 写入这个孩子的个体教育方式；`clear=true` 清空并恢复继承家庭设置 |

`get_effective_skill` 返回中与孩子维度相关的字段：

| 字段 | 含义 |
| --- | --- |
| `child_id` / `child_name` | 本次解析针对的孩子，不传 `child_id` 时为 `null` |
| `child_profile` | 生效中的孩子级配置，没有则为 `null` |
| `child_overrides` | 这个孩子实际覆盖了哪些字段（`philosophy` / `communicationStyle` / `strictness` / `parentGoals`） |
| `resolved_settings` | 合并后的最终设置（理念、沟通风格、严格程度、家长目标） |
| `resolution` | `child`（孩子级生效）/ `family`（无孩子级配置）/ `default`（全部走兜底默认值） |

约束：

- 所有孩子级参数都是**可选**，不传时返回值与字段含义不变，既有调用无需改动；
- `effective_content` 只做加法：存在孩子级配置时才追加"孩子个体差异配置"段落，该段落明确声明"与家庭配置不一致时以本节为准"；
- 家庭身份仍只由授权决定，不接受调用方传入 `family_id`；`child_id` 必须在当前家庭内校验通过；
- 不要把一个孩子的偏好、目标或学习特点套用到另一个孩子身上。

## 错题工具

| 工具 | 关键参数 | 用途 |
| --- | --- | --- |
| `save_wrong_question` | `child_id`、`question_id`、错误分析字段 | 保存或累计同一学生同一道错题 |
| `list_wrong_questions` | 学生、学科、题型、知识点、状态、`limit`、`offset` | 分页筛选错题 |
| `get_wrong_question` | `wrong_question_id` | 读取原题、证据、试卷和教学任务 |
| `update_wrong_question` | `wrong_question_id`、可修改元数据 | 修正章节、知识点和错误诊断 |
| `delete_wrong_question` | `wrong_question_id` | 无关联时删除，有关联时归档 |
| `update_wrong_question_status` | 状态、原因、来源或清除人工覆盖 | 人工状态管理 |
| `recalculate_wrong_question_mastery` | `wrong_question_id` | 重算错题和对应题型掌握度 |
| `get_wrong_question_practice_context` | `wrong_question_id`、目标难度、数量 | 获取 WorkBuddy 出题与规划上下文 |

错题状态：`pending_correction`、`strengthening`、`mastered`、`needs_review`、`archived`。

## 练习试卷工具

| 工具 | 关键参数 | 用途 |
| --- | --- | --- |
| `create_practice_paper` | `child_id`、标题、`questions[]` | 保存已写入题库的针对性试卷 |
| `list_practice_papers` | 学生、学科、状态、分页 | 查询试卷 |
| `get_practice_paper` | `practice_paper_id` | 读取题目、答案解析和作答 |
| `update_practice_paper` | 试卷 ID、状态/结果/题目清单 | 更新试卷 |
| `delete_practice_paper` | `practice_paper_id` | 无作答时删除，有作答时归档 |

`questions[]` 至少包含 `question_id`，可包含 `wrong_question_id`、`section`、`sequence`、`score`、`purpose` 和 `target_error_category`。变式题关联来源错题时设置 `allow_variant=true`。

## 教学规划工具

| 工具 | 关键参数 | 用途 |
| --- | --- | --- |
| `save_remediation_plan` | `child_id`、诊断、目标、策略、`tasks[]` | 保存错题教学规划 |
| `list_remediation_plans` | 学生、学科、状态、分页 | 查询规划 |
| `get_remediation_plan` | `remediation_plan_id` | 读取规划和任务证据 |
| `update_remediation_plan` | 规划 ID、元数据或完整任务清单 | 更新规划 |
| `update_remediation_task_status` | 规划 ID、任务 ID、状态、证据 | 跟踪任务执行 |
| `delete_remediation_plan` | `remediation_plan_id` | 无完成证据时删除，否则归档 |

任务状态：`pending`、`in_progress`、`completed`、`skipped`。

## 教材知识图谱工具

| 工具 | 关键参数 | 用途 |
| --- | --- | --- |
| `import_source_document` | 标题、类型、学科、年级、`nodes[]` | 保存教材或来源文件，可同时写入结构化知识节点 |
| `save_knowledge_nodes_batch` | `source_document_id`、`nodes[]` | 批量写回章节、知识点、概念、例题和常见错误 |
| `save_knowledge_relations_batch` | `source_document_id`、`relations[]` | 保存知识节点关系，常用 `PREREQUISITE_OF` 表达前置依赖 |
| `get_knowledge_context` | `child_id`、`knowledge_node_id` | 获取知识点、掌握证据、评估问句和带强度的前置知识点 |

知识节点字段：

- `evidence`：判断孩子是否掌握该知识点的具体证据；
- `assessment_prompt`：一句可用于口头或书面评估的问句；
- `common_errors`：常见错误和对应纠错提示。

前置关系字段：

- `relation_type`：默认 `PREREQUISITE_OF`；
- `strength`：`hard` 表示必须先掌握，`soft` 表示建议先了解；
- `reason`：一句话解释为什么存在该前置关系。

## 作答扩展参数

`record_question_attempt` 新增：

- `wrong_question_id`、`practice_paper_id`：关联错题和试卷；
- `is_original_correction`：是否为原题订正；
- `is_independent`：是否独立作答；
- `variation_type`：变式类型；
- `session_id`：练习会话；
- `save_to_wrong_book`：本次答错且家长明确要求保存时创建或累计错题。

完整工作规范由 MCP 的 `get_sync_spec` 实时返回，WorkBuddy 首次连接或工具更新后必须调用。
