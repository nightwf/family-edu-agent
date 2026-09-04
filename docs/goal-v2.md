# Codex 执行目标：禾芽家庭 AI 私教 V2

## 目标

将当前 `family-edu-agent` 项目从“教育数据后台”改造为“以孩子状态、目标计划、证据复测和教育方法为核心的 WorkBuddy 家庭私教”，并在完成后提交 WorkBuddy 开放平台审核。

## 执行范围

1. 按 `TECHNICAL_DESIGN_V2.md` 重构数据模型、API、MCP 和前端信息架构。
2. 保持 WorkBuddy 开放平台 Connector、Skill、Expert 交付方式不变，最终重新生成可审核 ZIP。
3. 不开发独立 AI 对话页面。
4. 保持数据按家庭隔离，支持一个账号加入多个家庭。
5. 老数据如迁移困难可以废弃，账号、家庭和孩子可重新录入。
6. 最终由当前 Codex 完整测试数据准确性、教育规则严谨性、页面简洁性和移动端可用性。

## 验收清单

- 家庭、账号、孩子、家庭边界 CRUD 完整可用。
- 一个账号可加入多个家庭，一个家庭可有多个管理者。
- 孩子状态由结构化证据生成，重要推断可确认或纠正。
- 目标、周计划、计划任务、复测形成完整闭环。
- 单次答对不会标记已掌握。
- 教材与知识节点有版本、时间有效性和来源引用。
- WorkBuddy 每次只获得当前上下文，不读取全量历史。
- Web 和小程序以孩子为中心，资源功能下沉，桌面和手机端布局正常。
- 数据库写入、分页、删除、家庭隔离测试通过。
- MCP smoke test 通过。
- WorkBuddy 开放平台校验通过，并生成新的 Connector、Skill、Expert ZIP。
- GitHub 仓库同步推送。

## 执行顺序

1. Phase 0：V2 数据模型与迁移。
2. Phase 1：身份、多家庭、家庭边界与 Token。
3. Phase 2：证据与学生状态。
4. Phase 3：目标、周计划与复测。
5. Phase 4：教材、知识库与教育方法。
6. Phase 5：MCP 与 WorkBuddy 开放平台包。
7. Phase 6：报告与后台任务。
8. Phase 7：Web 与小程序重构。
9. Phase 8：完整测试、部署、打包审核和 GitHub 推送。

## 测试要求

每个阶段完成后必须运行：

```bash
npm run test
npm run check:workbuddy
npm run package:workbuddy
```

最终额外执行 Web E2E、小程序校验、MCP smoke test，并检查关键页面截图。
