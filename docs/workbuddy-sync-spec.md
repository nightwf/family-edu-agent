# WorkBuddy 同步规范

WorkBuddy 负责教育对话和 Agent 执行，通过同一个 Family Education MCP 读取教育规则并写入家庭数据。首次连接、工具变化或不确定同步范围时调用 `get_sync_spec`。

## 通用规则

- 家庭身份只由 `X-MCP-Token` 确定，不传入或猜测 `family_id`；
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

## 题库流程

1. 识别题目的学科、年级、知识点和题型。
2. 调用 `list_question_types` 查重；没有匹配项时先询问家长，再创建题型。
3. 保存题目时必须包含题干、答案、解析、难度和变式类型；主观题还需评分量表。
4. 生成变式题前调用 `get_question_generation_context`。
5. 变式需覆盖不同表述、条件、易错点、综合步骤、迁移场景和延迟复习，不能只替换数字或人名。
6. 学生完成后调用 `record_question_attempt`，系统自动更新掌握度。
7. 单次答对不能宣布完全掌握。

## 安全与删除

- MCP 工具只访问 Token 对应家庭的数据；
- 有作答证据的题目不能硬删除，只能停用；
- 有关联题目的题型不能硬删除，只能停用；
- 人工调整掌握状态必须填写原因，可以清除人工调整恢复自动判断。
