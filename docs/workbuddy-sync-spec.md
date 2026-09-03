# WorkBuddy 同步规范

WorkBuddy 负责教育对话和 Agent 执行，通过同一个 Family Education MCP 读取教育规则并写入家庭数据。新会话首次使用禾芽时调用 `get_agent_bootstrap`；工具变化、复杂任务或不确定同步范围时再调用 `get_sync_spec`。

## 通用规则

- 家庭身份只由 `X-MCP-Token` 确定，不传入或猜测 `family_id`；
- 使用开放平台连接器后，家庭 Token 只在连接时配置一次，不要求家长每次粘贴提示词；
- 涉及学生时先调用 `list_children` 确认 `child_id`；
- 普通闲聊不自动保存；家长明确要求保存、同步、写入或记录时调用对应工具；
- 写入后读取结果确认，不把没有成功保存的内容描述为“已经同步”。

## 同步类型

| 场景 | 主要工具 |
| --- | --- |
| 写作 / 日记 | `save_writing_record`、`save_learning_record` |
| 阅读 / 复述 | `save_reading_record` |
| 家庭作业 | `save_homework`、`update_homework_status`、`complete_homework` |
| 总结 / 报告 / 建议 | `save_knowledge_item`、`list_knowledge_items` |
| 教材 | `import_textbook`、`list_textbooks`、`update_textbook` |
| 题型 | `list_question_types`、`create_question_type`、`update_question_type` |
| 题目 | `save_question`、`save_questions_batch`、`list_questions` |
| 同题型练习 | `get_question_generation_context`、`save_questions_batch` |
| 学生作答 | `record_question_attempt`、`list_question_attempts` |
| 掌握度 | `get_student_question_type_mastery`、`list_student_mastery`、`recalculate_student_mastery` |
| 错题 | `save_wrong_question`、`list_wrong_questions`、`get_wrong_question` |
| 错题掌握 | `record_question_attempt`、`recalculate_wrong_question_mastery`、`update_wrong_question_status` |
| 针对性练习 | `get_wrong_question_practice_context`、`save_questions_batch`、`create_practice_paper` |
| 教学规划 | `save_remediation_plan`、`update_remediation_task_status` |

## 题库流程

1. 识别题目的学科、年级、知识点和题型。
2. 调用 `list_question_types` 查重；没有匹配项时先询问家长，再创建题型。
3. 保存题目时必须包含题干、答案、解析、难度和变式类型；主观题还需评分量表。
4. 生成变式题前调用 `get_question_generation_context`。
5. 变式需覆盖不同表述、条件、易错点、综合步骤、迁移场景和延迟复习，不能只替换数字或人名。
6. 学生完成后调用 `record_question_attempt`，系统自动更新掌握度。
7. 单次答对不能宣布完全掌握。

## 错题流程

1. 先调用 `list_children` 确认学生，禁止按姓名猜测 `child_id`。
2. 真实答错且家长明确要求同步时，保证题目已在家庭题库，再调用 `record_question_attempt`，传入 `is_correct=false` 和 `save_to_wrong_book=true`。
3. 同一学生同一题重复出错由系统累计；不要重复创建相似题目规避唯一约束。
4. 记录错误答案、错误原因、错误分类、WorkBuddy 分析、订正方法和关键学习点。
5. 原题订正、变式练习、试卷作答都继续使用 `record_question_attempt`，并传入 `wrong_question_id`、`is_original_correction`、`is_independent`、`variation_type` 和 `session_id`。
6. 单次订正不能判定掌握。默认需原题订正、3 道不同独立正确变式、2 次会话、迁移题和 24 小时后复测，掌握分至少 80。
7. 已掌握后再次答错，系统自动转为“需复习”。人工修改必须填写原因，不得用人工状态伪造作答证据。

## 针对性练习与教学规划

1. 生成前调用 `get_wrong_question_practice_context`，读取原题、错误诊断、题型不变量、未覆盖变式和掌握证据。
2. 练习应覆盖不同表述、条件变化、易错点、多步骤、迁移和延迟复习，不得只替换数字或人名。
3. 生成题必须包含答案、解析、难度、变式类型、来源题和规则版本；先通过 `save_questions_batch` 写入题库，再调用 `create_practice_paper`。
4. 教学规划包含诊断、目标、策略、日期和任务，使用 `save_remediation_plan` 保存；任务执行后调用 `update_remediation_task_status`。
5. 完成试卷或教学任务不等于掌握，仍以真实作答证据和延迟复测为准。

## 安全与删除

- MCP 工具只访问 Token 对应家庭的数据；
- 有作答证据的题目不能硬删除，只能停用；
- 有关联题目的题型不能硬删除，只能停用；
- 人工调整掌握状态必须填写原因，可以清除人工调整恢复自动判断。
- 有练习、试卷或教学任务关联的错题删除时自动归档；有作答的试卷和有完成证据的教学规划同样归档；
- 列表工具必须使用 `limit` / `offset` 分页，大批量同步应分批执行并读取写入结果。
