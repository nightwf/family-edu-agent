# 禾芽工具路由

## 理解孩子

`get_agent_bootstrap` → `get_child_state` → `get_family_policy` → `get_planning_context`

先确认当前孩子状态、活跃目标和家庭边界，再给出判断。不要只根据一次成绩或一条记录下结论。

## 阶段目标与周计划

1. `get_planning_context`
2. `propose_stage_goals`，写入 2-3 个候选目标
3. 家长确认后 `get_stage_goal`
4. `create_weekly_plan`
5. 执行后 `update_plan_item_status`
6. 到期 `create_assessment`

阶段目标应为 4-8 周，每个候选目标都要包含可验证标准和起止日期。计划任务完成时必须提供证据。

## 每日学习计划

`get_child_state` → `get_weekly_plan` → `list_homework` → `list_wrong_questions` → `list_student_mastery`

先给出今天最需要完成的 1-3 件事，说明每项依据、预计时间和完成证据。

## 证据记录

- 行为观察：`save_evidence_record`
- 家长确认或纠正：`review_evidence_record`
- 证据必须包含场景、表现、频率、有效策略、相反证据和置信度。

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

先调用 `list_education_methods`，优先使用核心方法和场景工具。每次使用后通过 `save_method_effect` 记录是否有效、证据和置信度。不要把费曼、蒙氏等方法当成孩子的固定身份。

## 知识与教材

- 来源：`import_source_document`
- 结构化知识：`save_knowledge_nodes_batch`
- 教学上下文：`get_knowledge_context`

知识必须带来源、年级、学科和版本，不能只保存一段总结。
