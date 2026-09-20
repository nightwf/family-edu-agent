# 禾芽工具路由

## 理解孩子

`get_agent_bootstrap` → `get_child_state` → `get_family_policy` → `get_learning_priorities` → `get_planning_context`

先确认当前孩子状态、活跃目标和家庭边界，再给出判断。不要只根据一次成绩或一条记录下结论。

## 学习优先级与待规划

`get_learning_priorities` → `list_planning_requests` → `get_planning_context` → `propose_stage_goals` → `update_planning_request_status`

1. 学习优先级由禾芽按固定规则算好：前置知识缺口 > 重复出错 > 复测到期 > 掌握度偏低 > 变式覆盖不足，再加严重度和目标相关性。
   必须引用返回的 `reason` 与 `priority_score`，不要自己另排优先级，也不要编造依据。
2. 家长端出现待规划事项时，先 `list_planning_requests` 找到它，读完优先级再制定目标；写回候选目标后用
   `update_planning_request_status` 标记 `completed`，并按需关联 `stage_goal_id`。
3. 教材知识节点建好后，用 `link_question_type_knowledge` 把题型关联到知识节点；单题考察多个知识点时用
   `link_question_knowledge` 覆盖题型默认关联。
4. 题目答案修改后用 `verify_question_answer` 复验。返回 `unverified` 的题目不得当作已验证答案使用。
5. 练习或计划执行后，用 `record_recommendation_outcome` 记录真实效果。

## 阶段目标与周计划

1. `get_planning_context`
2. `get_learning_priorities`
3. `propose_stage_goals`，写入 2-3 个候选目标
4. 家长确认后 `get_stage_goal`
5. `create_weekly_plan`
6. 执行后 `update_plan_item_status`
7. 到期 `create_assessment`

阶段目标应为 4-8 周，每个候选目标都要包含可验证标准和起止日期，并覆盖排在前面的学习优先级。
计划任务完成时必须提供证据。

### 周计划任务类型（必填枚举）

`create_weekly_plan` 每条任务的 `type` 只能取下列值，大小写不敏感，也可以直接写中文：

| 取值 | 中文 | 用在哪 |
| --- | --- | --- |
| `SCHOOL_HOMEWORK` | 学校作业 | 学校老师布置的作业 |
| `CHILD_TASK` | 孩子任务 | 给孩子的练习与巩固 |
| `PARENT_ACTION` | 家长行动 | 需要家长配合完成的事 |
| `AGENT_TASK` | AI 任务 | 智能体自己执行的事，例如出题、整理 |
| `RETEST` | 复测 | 延迟复测与复习检测 |

`update_plan_item_status` 的 `status` 只能取 `PENDING`(待开始) / `IN_PROGRESS`(进行中) / `COMPLETED`(已完成) / `SKIPPED`(已跳过) / `CANCELLED`(已取消) / `NEEDS_REVIEW`(需复测)。
写错时接口会把全部合法值写在报错里，直接按提示改用即可，不需要反复试错。

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
- 知识节点应尽量包含掌握证据 `evidence`、评估问句 `assessment_prompt`、常见错误 `common_errors`，不能只保存标题和简介
- 前置关系：`save_knowledge_relations_batch`，优先保存为 `PREREQUISITE_OF`
- 每个前置关系必须区分 `strength: hard|soft`，并写清 `reason`，不能只写“相关”
- 教学上下文：`get_knowledge_context`

知识必须带来源、年级、学科和版本，不能只保存一段总结。`get_knowledge_context` 会返回当前节点的证据字段和带 `relation_strength` / `relation_reason` 的前置知识点，规划和讲解时应优先使用这些信息。

## 亲子关系

- 读取：`get_child_relationship`
- 写入：`save_child_relationship`
- 历史：`list_child_relationship_history`

关系记录必须包含状态、评分、沟通说明、冲突次数和家长行动，不能只写一句“关系不好”。
