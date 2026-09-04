# 禾芽家庭 AI 私教 V2 验收报告

> 生成时间：2026-09-05
> 状态：开发、部署和自动化测试已完成；GitHub 最后同步待网络恢复

## 已完成验收项

### 数据与业务

- V2 Prisma 数据模型已加入并通过 `prisma validate`。
- 增量迁移已生成：`prisma/migrations/20260905_add_v2_core/migration.sql`。
- 家庭边界、证据、学生状态、阶段目标、周计划、复测、知识节点和教育方法均有领域服务和测试。
- 家庭身份由 `X-MCP-Token` 确定，REST 由 JWT 确定，资源 ID 写入前校验家庭归属。
- 单次答对不会标记已掌握，已有题库和错题业务规则继续生效。

### API 与 MCP

- 新增 `/api/v2/*` 接口。
- 家庭支持多管理者、邀请、加入和切换。
- 同一个 Family Education MCP 新增孩子状态、家庭边界、目标计划、证据、知识和教育方法工具。
- WorkBuddy 启动和同步提示词已更新。

### Web 与小程序

- Web 首页改为孩子状态总览，可确认或纠正证据。
- 新增计划页，家长可确认候选阶段目标。
- 设置页改为家庭边界和多家庭切换，教育方法库只读。
- 小程序首页接入 V2 孩子状态和当前目标。
- 小程序“我的”页新增家庭边界、多家庭切换和教育方法库。

### 测试证据

- API 单元与集成测试：38 个通过。
- API TypeScript 构建：通过。
- Web Vite 构建：通过。
- 小程序结构校验：通过。
- WorkBuddy 开放平台校验：通过。
- WorkBuddy ZIP 重新生成：Connector、Skill、Expert。
- 真实 MCP smoke test：通过，服务端返回 105 个工具。
- Playwright E2E：2 个场景通过，覆盖题库、错题、家庭隔离和移动端横向溢出。
- E2E 移动端截图尺寸：390x926；桌面截图尺寸：1280x783。

### 部署

- 已部署到 `http://49.234.4.212/family-edu/`。
- `GET /family-edu/api/health`：200。
- `GET /family-edu/`：200。
- 部署只重建本项目 `api` 容器，未触碰其他系统。
- 临时 smoke/E2E 测试家庭和账号已从 PostgreSQL 清理。

## 待完成

- GitHub 已同步到最新提交。
- WorkBuddy 开放平台当前资产均处于“审核中”，但需要撤回后重新提交最新包：
  - Connector：`oc_3de0b7a7c0596827`
  - Skill：`os_a90004f6b04a053d`
  - Expert：`oe_a90004f6b04a053d`

重新提交顺序：

1. 撤回 Connector 当前审核。
2. 上传 `heyah-family-education-connector.zip` 并提交审核。
3. 撤回 Skill 当前审核。
4. 上传 `heyah-family-private-tutor-skill.zip` 并提交审核。
5. 撤回 Expert 当前审核。
6. 上传 `heyah-family-private-tutor-expert.zip` 并提交审核。
