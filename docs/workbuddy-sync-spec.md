# WorkBuddy 同步规范

WorkBuddy 负责教育对话和 Agent 执行，通过同一个 Family Education MCP 读取教育规则并写入家庭数据。新会话首次使用禾芽时调用 `get_agent_bootstrap`；工具变化、复杂任务或不确定同步范围时再调用 `get_sync_spec`。

## 通用规则

- 家庭身份只由连接授权（WorkBuddy OAuth Access Token，过渡期兼容家庭 Token）确定，不传入或猜测 `family_id`；
- 使用开放平台连接器后，首次连接由微信扫码授权完成，不要求家长粘贴 Token 或提示词；
- 涉及学生时先调用 `list_children` 确认 `child_id`；
- 教育方式按孩子区分：执行某个孩子的任务前先调用 `get_effective_skill` 并传 `child_id`，拿到「家庭策略 + 孩子个体调整」合并后的结果；不传 `child_id` 只返回家庭级设置；
- 普通闲聊不自动保存；家长明确要求保存、同步、写入或记录时调用对应工具；
- 写入后读取结果确认，不把没有成功保存的内容描述为“已经同步”。

## 同步类型

| 场景 | 主要工具 |
| --- | --- |
| 学科概览 | `get_subject_overview`、`get_learning_priorities` |
| 教育方式（按孩子） | `get_child_education_profile`、`get_effective_skill`、`update_child_education_profile`、`update_family_policy` |
| 写作 / 日记 | `save_writing_record`、`save_learning_record` |
| 阅读 / 复述 | `save_reading_record` |
| 家庭作业 | `save_homework`、`update_homework_status`、`complete_homework` |
| 总结 / 报告 / 建议 | `save_knowledge_item`、`list_knowledge_items` |
| 教材 | `import_textbook`、`list_textbooks`、`update_textbook` |
| 知识图谱 | `import_source_document`、`save_knowledge_nodes_batch`、`save_knowledge_relations_batch` |
| 教学上下文 | `get_knowledge_context` |
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

## 教材知识图谱流程

1. 上传教材或材料后先调用 `import_source_document` 保存来源文档。
2. 通过 `save_knowledge_nodes_batch` 写回章节、知识点、概念、例题和常见错误。
3. 每个知识点尽可能补充 `evidence`（掌握证据）、`assessment_prompt`（评估问句）和 `common_errors`（常见错误）。
4. 保存知识点后调用 `save_knowledge_relations_batch` 建立前置关系；只写“相关”不算完整关系。
5. 前置关系默认使用 `PREREQUISITE_OF`，必须区分 `hard`（必须先掌握）和 `soft`（建议掌握），并用 `reason` 说明原因。
6. 后续规划、讲解和掌握判定先调用 `get_knowledge_context`，不要绕过已知证据和前置关系。

## 学习优先级流程

1. 涉及“接下来学什么”的问题，先调用 `get_learning_priorities`，不要用模型推测代替。
2. 优先级由禾芽按固定规则计算：前置知识缺口 > 重复出错 > 复测到期 > 掌握度偏低 > 变式覆盖不足；
   另加严重度、与当前阶段目标的相关性和新鲜度。必须引用返回的 `reason` 与 `priority_score` 作为依据。
3. 教材知识节点建立后，用 `link_question_type_knowledge` 把题型关联到知识节点；一道题考察多个知识点时用
   `link_question_knowledge` 覆盖题型默认关联。作答后禾芽会自动刷新对应知识点的掌握状态，不需要重复手写。
4. 题目答案或选项被修改后调用 `verify_question_answer` 复验。`calculation` 类型若包含无法用四则运算核对的内容，
   会返回 `unverified`，不得当成已验证答案使用；主观题返回 `not_applicable`，需要评分量表或人工确认。
5. 家长端出现待规划事项时，先 `list_planning_requests` 找到事项，读完 `get_learning_priorities` 与
   `get_planning_context` 再制定目标，写回后用 `update_planning_request_status` 标记 `completed`，并按需关联 `stage_goal_id`。
6. 练习或计划执行后，用 `record_recommendation_outcome` 记录这次建议的真实效果
   （`improved` / `unchanged` / `worse` / `unmeasurable`）。
7. 已经解决的信号用 `resolve_learning_signal` 处理，保持首页只显示当前真正需要关注的问题。

## 学科概览流程

1. 家长问“哪一科要优先处理”“各科现在什么情况”时，先调用 `get_subject_overview`，不要用单点成绩或一次对话推断学科全貌。
2. 概览会列出孩子**全部关注学科**，包括暂时没有数据的学科；没有数据的学科按空状态说明，不跳过、不编造。
3. 说完学科结论后，再用 `get_learning_priorities` 给出具体要处理的事，并引用返回的 `reason` 与 `priority_score`。
4. 学科概览是只读的，不写入任何数据。

## 教育方式流程（按孩子维度）

1. 同一个家庭的不同孩子可以有各自的教育方式；解析顺序是「全局基础技能 → 家庭策略 → 孩子级调整」，孩子级为空的字段逐项继承家庭设置。
2. 执行某个孩子的任务前调用 `get_effective_skill`，**必须带上 `child_id`**，按返回的 `resolved_settings` 与 `effective_content` 执行。
3. `get_effective_skill` 的 `resolution` 表示这套设置从哪来：`child` 是孩子级生效，`family` 是没有孩子级配置，`default` 是家庭和孩子都没设过。`child_overrides` 列出这个孩子实际覆盖了哪些字段。
4. 想先看全貌时调用 `get_child_education_profile`，一次读出这个孩子每个教育场景的个体配置、家庭继承值和最终生效设置。
5. 家长说"这个孩子单独这样带"时调用 `update_child_education_profile` 写孩子级；说"全家都这样"时调用 `update_family_policy`（不带 `child_id`）写家庭级。
6. 家长要求恢复默认时用 `clear=true` 清空孩子级配置，回到继承家庭设置。
7. 家长目标、学习特点都属于孩子级信息，**不得跨孩子套用**；不要把一个孩子的偏好、目标或学习特点用到另一个孩子身上。
8. 单次对话里的临时偏好不等于长期设置；只有家长明确要求保存时，才写入孩子级或家庭级。

## 枚举取值

下面这些字段在数据库里是枚举。请直接使用给出的取值，大小写不敏感，也可以直接写括号里的中文名称。
写错时接口会返回全部合法值，不要靠试错猜测。

| 字段 | 合法取值 |
| --- | --- |
| `create_weekly_plan` 的 `items[].type` | `SCHOOL_HOMEWORK`(学校作业)、`CHILD_TASK`(孩子任务)、`PARENT_ACTION`(家长行动)、`AGENT_TASK`(AI 任务)、`RETEST`(复测) |
| `update_plan_item_status` 的 `status` | `PENDING`(待开始)、`IN_PROGRESS`(进行中)、`COMPLETED`(已完成)、`SKIPPED`(已跳过)、`CANCELLED`(已取消)、`NEEDS_REVIEW`(需复测) |
| `save_evidence_record` 的 `type` | `OBSERVATION`(行为观察)、`WRITING`(写作)、`READING`(阅读)、`HOMEWORK_COMPLETION`(作业完成)、`QUESTION_ATTEMPT`(作答记录)、`RETEST`(复测结果)、`PARENT_NOTE`(家长记录) |
| `save_knowledge_nodes_batch` 的 `nodes[].type` | `CHAPTER`(章节)、`KNOWLEDGE_POINT`(知识点)、`CONCEPT`(概念)、`EXAMPLE`(例题)、`MISCONCEPTION`(常见错误) |
| `save_knowledge_relations_batch` 的 `relations[].relation_type` | `PREREQUISITE_OF`(前置依赖，默认)、`CONTAINS`(包含)、`RELATED_TO`(相关)、`EXAMPLE_OF`(例题属于)、`ERROR_OF`(易错点属于) |
| `update_child_knowledge_state` 的 `status` | `UNASSESSED`(未评估)、`LEARNING`(学习中)、`PARTIAL`(部分掌握)、`MASTERED`(已掌握)、`NEEDS_REVIEW`(需复习) |

补充说明：

- `create_weekly_plan` 的每条任务都要有 `type`，缺省或写错都会被拒绝；
- 任务类型决定这条任务归谁做：`SCHOOL_HOMEWORK` 是学校布置的作业，`CHILD_TASK` 是给孩子的练习，`PARENT_ACTION` 是家长要配合的事，`AGENT_TASK` 是智能体自己执行的事，`RETEST` 是延迟复测；
- 完成任务（`COMPLETED`）必须同时提供 `evidence`，否则会被拒绝。

## 安全与删除

- MCP 工具只访问当前授权对应家庭的数据；
- 有作答证据的题目不能硬删除，只能停用；
- 有关联题目的题型不能硬删除，只能停用；
- 人工调整掌握状态必须填写原因，可以清除人工调整恢复自动判断。
- 有练习、试卷或教学任务关联的错题删除时自动归档；有作答的试卷和有完成证据的教学规划同样归档；
- 列表工具必须使用 `limit` / `offset` 分页，大批量同步应分批执行并读取写入结果。
