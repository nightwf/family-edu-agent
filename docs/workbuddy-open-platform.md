# WorkBuddy 开放平台接入

禾芽采用 WorkBuddy 官方推荐的 `MCP + Skill` 连接器方案，并提供一个依赖该 MCP 的“禾芽家庭私教”Expert。现阶段使用用户自填 Token 模式；家庭 Token 只保存在用户本机 WorkBuddy 中，不写入发布包。

## 产品组合

| 开放平台资产 | 名称 | 作用 |
| --- | --- | --- |
| Connector | 禾芽家庭教务 | 连接家庭学生档案、作业、错题、题库、报告和成长记录 |
| Skill | 禾芽家庭私教 | 规定先了解孩子、再规划、再追踪证据的教育工作流程 |
| Expert | 禾芽家庭私教 | 提供家长可直接召唤的家庭私教入口，并引导完成 MCP 连接 |

Buddy 应用暂不进入第一版发布。当前产品仍由禾芽 Web/小程序负责数据查看与家庭设置，WorkBuddy 负责 AI 对话和 Agent 执行。等 Connector、Skill、Expert 验证稳定后，再考虑用 Buddy 应用包装独立行业工作台。

## 已准备的提交包

源文件：

- `workbuddy-open-platform/connector/heyah-family-education/`
- `workbuddy-open-platform/expert/heyah-family-private-tutor/`

生成上传 ZIP：

```bash
npm run package:workbuddy
```

输出：

- `workbuddy-open-platform/dist/heyah-family-education-connector.zip`
- `workbuddy-open-platform/dist/heyah-family-private-tutor-skill.zip`
- `workbuddy-open-platform/dist/heyah-family-private-tutor-expert.zip`

## 家庭授权

Connector 使用 `auth_mode: token`，最低 WorkBuddy 版本为 4.24.0。连接时展示“家庭专属 Token”密码输入框，并将用户填写的值注入：

```text
X-MCP-Token: ${HEYA_FAMILY_TOKEN}
```

发布包内只能保留 `${HEYA_FAMILY_TOKEN}` 占位符，严禁写入真实 Token。服务端继续只从请求头解析家庭身份，不能信任工具参数中的 `family_id`。

## 新会话启动

Expert 或 Skill 在新会话第一次处理家庭教育任务时调用：

```text
get_agent_bootstrap
```

该工具一次返回当前家庭的学生列表、数据概况、常用任务路由、安全边界和建议下一步。WorkBuddy 不需要让家长重复粘贴整段提示词。复杂同步、题库或错题任务再调用 `get_sync_spec` 获取详细规则。

标准流程：

```text
召唤禾芽家庭私教
  → 首次连接时填写家庭 Token
  → get_agent_bootstrap
  → 按姓名确定 child_id
  → get_child_context
  → get_effective_skill
  → 读取任务相关数据
  → 给出计划/辅导
  → 用户要求保存时写回禾芽
```

## 开放平台提交顺序

1. 在开放平台创建并上传 Connector ZIP，完成测试与审核。
2. 在 WorkBuddy 测试连接器，确认 `get_agent_bootstrap`、`list_children`、`get_child_context` 可调用。
3. 需要独立上架教育方法时上传 Skill ZIP；Connector 和 Expert 已内置同一份 Skill，不上架也不影响使用。
4. 上传 Expert ZIP，确认召唤时出现家庭 Token 连接卡片。
5. 使用三个快捷问题分别测试今日计划、错题练习和月度成长总结。
6. 审核通过后再公开发布。

## 后续 OAuth

Token 模式适合当前 MVP，但家庭用户仍需从禾芽设置页复制一次 Token。公开用户规模扩大后，应升级为 OAuth 2.1 + PKCE：用户点击连接后登录禾芽并选择家庭，由禾芽签发短期访问 Token 和 Refresh Token。OAuth 上线前保留当前 Token 模式，不阻塞开放平台首版验证。

## 官方规范

- [WorkBuddy 开放平台概述](https://open.workbuddy.cn/docs/what-is-open-platform)
- [WorkBuddy Skill 规范](https://open.workbuddy.cn/docs/skill)
- [WorkBuddy Connector 规范](https://open.workbuddy.cn/docs/connector)
- [WorkBuddy Expert 规范](https://open.workbuddy.cn/docs/expert)
- [WorkBuddy Buddy 应用说明](https://open.workbuddy.cn/docs/buddy-app)
