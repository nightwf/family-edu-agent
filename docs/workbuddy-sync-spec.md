# WorkBuddy 同步规范

WorkBuddy 生成家庭教育内容后，通过 Family Education MCP 写入项目。规范源文件位于 `src/workbuddy-spec.js`，MCP 提供 `get_sync_spec` 工具供 WorkBuddy 主动读取。

## 同步类型

| 类型 | 保存工具 | 关键字段 |
| --- | --- | --- |
| 作文 / 日记 | `save_writing_record` | `child_id`、`title`、`date`、`score`、`notes` |
| 阅读复述 | `save_reading_record` | `child_id`、`title`、`date`、`score`、`notes` |
| 学习记录 | `save_learning_record` | `child_id`、`type`、`title`、`score` |
| 家长笔记 | `save_parent_note` | `child_id`、`title`、`notes` |
| 阶段总结 | `save_knowledge_item` | `kind="summary"`、`title`、`content` |
| 成长报告 | `save_knowledge_item` | `kind="report"`、`title`、`content` |
| 教育建议 | `save_knowledge_item` | `kind="suggestion"`、`title`、`content` |
| 教材 | `import_textbook` | `child_id`、`title`、`subject`、`grade`、`publisher`、`version`、`file` |
| 学习任务 | `create_learning_task` | `child_id`、`title`、`estimated_minutes`、`deadline` |
| 家庭作业 | `save_homework` | `child_id`、`title`、`subject`、`deadline`、`status` |
| 作业完成 | `complete_homework` | `homework_id` |

## 保存原则

- 涉及孩子时必须先确认 `child_id`；
- 家长明确要求“保存、同步、写入、记录”时必须执行；
- 生成报告、总结、建议后主动建议保存；
- 普通闲聊和泛化教育内容不自动保存。

## WorkBuddy 接入

连接提示词已包含本规范。WorkBuddy 不确定同步规则时，可调用：

```text
get_sync_spec
```
