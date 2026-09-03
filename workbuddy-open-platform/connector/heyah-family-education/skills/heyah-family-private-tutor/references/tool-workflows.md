# 禾芽工具路由

## 每日学习计划

`get_agent_bootstrap` → `get_child_context` → `list_homework` → `list_wrong_questions` → `list_student_mastery` → `list_remediation_plans`

先给出今天最需要完成的 1-3 件事，说明每项依据、预计时间和完成证据。只有家长要求保存计划时才调用 `save_remediation_plan` 或 `save_knowledge_item`。

## 作业

- 录入：`list_children` → `save_homework`
- 查看：`list_homework`
- 修改状态：`update_homework_status`
- 完成：`complete_homework`
- 删除：`delete_homework`，删除前必须获得用户明确确认

## 题库与错题

- 录题：`list_question_types` → 必要时确认后 `create_question_type` → `save_question`
- 同题型：`get_question_generation_context` → `save_questions_batch`
- 记录作答：`record_question_attempt`
- 错题练习：`get_wrong_question_practice_context` → `save_questions_batch` → `create_practice_paper`
- 掌握判断：`recalculate_wrong_question_mastery` 与 `get_student_question_type_mastery`

生成题目必须包含答案、解析、难度、变式类型、来源题目和规则版本。不能只替换数字或人名。

## 成长与报告

`get_child_context` → `get_learning_history` / `get_growth_summary` / `list_reports` → `create_report` 或 `save_knowledge_item`

报告应区分事实、推断和建议，不把短期波动描述成长期能力问题。

## 教育方法

先调用 `list_education_skills` 确认方法，再调用 `get_effective_skill` 获取当前家庭版本。不要用全局默认方法覆盖家庭已经确认的教育偏好。
