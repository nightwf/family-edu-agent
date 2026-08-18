# Family Education MCP 工具说明

MCP 地址为 `http://49.234.4.212/family-edu/mcp`。每个家庭使用独立 `X-MCP-Token`，服务端只从 Token 获取 `familyId`，所有资源 ID 还会再次校验家庭归属。

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

## 作答扩展参数

`record_question_attempt` 新增：

- `wrong_question_id`、`practice_paper_id`：关联错题和试卷；
- `is_original_correction`：是否为原题订正；
- `is_independent`：是否独立作答；
- `variation_type`：变式类型；
- `session_id`：练习会话；
- `save_to_wrong_book`：本次答错且家长明确要求保存时创建或累计错题。

完整工作规范由 MCP 的 `get_sync_spec` 实时返回，WorkBuddy 首次连接或工具更新后必须调用。
