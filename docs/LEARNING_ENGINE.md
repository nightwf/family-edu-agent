# 学习决策层（Learning Engine）

> 目的：回答一个具体问题——**这个孩子现在最应该学什么，为什么，练到什么程度算过，什么时候复测。**

## 职责边界

| 角色 | 负责 |
| --- | --- |
| 禾芽 | 保存事实、按规则算触发信号与优先级、限定验证标准、判定客观结果 |
| WorkBuddy | 读取信号，解释错误原因、制定候选目标、生成计划与练习、执行讲解 |
| 家长 | 确认目标与计划、修正主观判断 |

禾芽不调用大模型，也不生成学习计划。它只把“现在该关注什么”算清楚，并保证结论可解释、可追溯。

## 一、知识点回写

- 题型通过 `QuestionTypeKnowledgeNode` 关联知识节点，单题可用 `QuestionKnowledgeNode` 覆盖题型默认关联。
- 每次 `recordQuestionAttemptWithWrongBook` 写入作答后，自动刷新相关知识点的 `ChildKnowledgeState`。
- 掌握聚合组件与题库题型掌握度一致（正确率 35、独立作答 20、变式覆盖 20、迁移 15、延迟复测 10），
  同一份证据在不同页面不会得出不同结论。
- 人工修正过的状态不会被自动计算覆盖，自动计算值保存在 `evidence.calculated_status` 便于对比。
- “是否退步”与上一次**自动计算结果**比较，不与人工状态比较。

## 二、学习触发信号

| 类型 | 触发条件 | 基础优先级 |
| --- | --- | --- |
| `PREREQUISITE_GAP` | 正在学的知识点，其 `PREREQUISITE_OF` 前置节点未达标 | 100 |
| `REPEATED_ERROR` | 同一错题 14 天内重复出错 ≥ 2 次 | 90 |
| `REVIEW_DUE` | 题型或错题到达 `nextReviewAt` | 80 |
| `LOW_MASTERY` | 练习 ≥ 3 次后掌握分仍 < 60 | 70 |
| `VARIATION_GAP` | 练习 ≥ 3 次但变式数量不足 | 60 |

信号来自作答、错题与掌握状态，不做情绪或心理推断。每次同步会写入新信号，并把已经消失的信号标记为 `resolved`。

## 三、优先级排序

```
priority_score = 类型基础分 + 严重度 × 5 + 目标相关性(最多 15) + 新鲜度(最多 10)
```

- 目标相关性：信号所属学科或题型名称出现在当前阶段目标的标题或目标描述中。
- 新鲜度：信号越新分越高，14 天后归零。
- 排序结果对外暴露 `priority_score` 与 `priority_breakdown`，家长和 WorkBuddy 都能看到加分来源。

## 四、待规划事项

- 没有生效中的阶段目标，或存在 `priority_score ≥ 70` 的信号时，`ensurePlanningRequest` 创建 `pending` 事项。
- 同一学生同时只保留一条 `pending` / `in_progress` / `awaiting_confirmation` / `failed` 事项，避免重复。
- 家长在网页或小程序首页点击「让 AI 制定计划」，禾芽内置豆包读取规划上下文并生成候选阶段目标与周计划草稿。
- 草稿保存为 `PROPOSED` 目标与 `DRAFT` 周计划；家长确认前不会进入执行状态。
- 家长确认后，推荐目标与周计划一起变为 `ACTIVE`，未采用的候选目标自动取消。
- 规划模型请求使用独立的 `PLANNER_REQUEST_TIMEOUT_MS`（默认 90 秒），避免影响实时私教对话的 45 秒上限。
- 规划属于结构化生成任务，豆包请求显式关闭深度思考，减少等待时间和无关推理开销。
- WorkBuddy 仍可读取同一条待规划事项，并通过原有目标、周计划工具写入同一套数据。

**设计取舍**：WorkBuddy 不会因为数据库变化自动醒来，因此默认采用“禾芽发现 + 家长点击 + 内置 AI 生成草稿”。
生成动作由家长明确触发以控制成本，最终仍由家长确认；WorkBuddy 是兼容的另一条规划入口，不再依赖复制提示词。

## 五、答案验证

| 题型 | 验证方式 | 结果 |
| --- | --- | --- |
| 单选/多选/判断 | 选项匹配 | `verified` / `failed` |
| 填空 | 去空格与大小写归一后比对 | `verified` / `failed` |
| 计算 | 内置四则运算与乘方求值（不执行任意代码） | `verified` / `unverified` |
| 简答/作文 | 检查评分量表 | `not_applicable` |

- 无法验证的内容明确标记，不冒充已核对；主观题缺少评分量表会给出错误提示。
- 新建题目自动验证；更新题目仅在改动答案、选项、类型或评分标准时重新验证，避免抹掉已有结果。

## 六、推荐效果追踪

`RecommendationOutcome` 记录某个建议执行后的真实结果（`improved` / `unchanged` / `worse` / `unmeasurable`），
用于后续判断“这套推荐到底有没有用”，而不是只看完成了多少任务。

## 七、相关接口

MCP 工具：`get_learning_priorities`、`list_learning_signals`、`resolve_learning_signal`、
`link_question_type_knowledge`、`list_question_type_knowledge`、`unlink_question_type_knowledge`、
`link_question_knowledge`、`list_question_knowledge`、`create_planning_request`、`list_planning_requests`、
`get_planning_request`、`update_planning_request_status`、`record_recommendation_outcome`、
`list_recommendation_outcomes`、`verify_question_answer`。

REST 接口：`/api/v2/children/:childId/learning-priorities`、`/api/v2/children/:childId/learning-signals`、
`/api/v2/learning-signals/:signalId/resolve`、`/api/v2/question-types/:id/knowledge-nodes`、
`/api/v2/questions/:id/knowledge-nodes`、`/api/v2/questions/:id/verify-answer`、
`/api/v2/planning-requests`、`POST /api/v2/planning-requests/:id/generate-ai`、
`POST /api/v2/planning-requests/:id/confirm-ai`、`/api/v2/recommendation-outcomes`。

`get_planning_context` 现在会同时返回 `learning_priorities` 和 `learning_signals`，WorkBuddy 制定目标时必须先读取。
