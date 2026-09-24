# Codex 执行目标：禾芽内置学习私教（Education Agent Layer）落地

## 一、目标

在 `family-edu-agent` 现有系统之上新增一个家庭 AI 私教对话智能体，**本期一次做成完整私教**：文字对话、拍图讲错题、按住说话、孩子记忆、证据回流、家长确认、实时语音、输出多模态，全部在首发范围内。入口本期只在安卓 APK 端出现。

设计依据：`docs/TUTOR_AGENT_DESIGN.md`（含 20 节对 WorkBuddy 的影响评估）。本文只定义执行范围与验收口径，细节以该设计文档为准。

## 二、项目路径与基线

- 路径：`/Users/nightwf/Desktop/儿童AI教育/family-edu-agent`
- 分支：`main`，起始 HEAD `be22e0e`
- 线上：`https://heyaagent.top/`（网站）、`https://heyaagent.top/family-edu/`（旧路径）
- 服务器：`root@49.234.4.212`，部署脚本 `bash deploy/remote.sh`
- 测试基线（含已恢复的孩子维度代码）：API 25 文件 131 用例通过 + 小程序 19 页校验通过
- 现状：孩子维度教育方式代码已从暂存区恢复到工作区，测试全绿，待随本批迁移上线
- 已就绪：PostgreSQL、MinIO（`family-edu-agent-minio-1` 运行中，图片存储链路通）、微信小程序凭据

## 三、已确认的产品决定（不得改动）

1. **单一账号，不做权限分层。** 私教归家长账号使用，不建第二套账号体系、不做角色权限。能用的人就是家庭管理者，能力范围不超过他本人已有权限。
2. **入口只在安卓 APK 端。** 网页端与小程序本期不加私教入口。
3. **一次做成完整私教。** 不交付"最小可用版"。内部可分施工顺序，但不对外分批发版。
4. **模型全部用豆包（火山方舟）。** 对话、视觉、语音识别、语音合成、内容审核统一走火山引擎，不混用多家。
5. **孩子维度教育方式随本批上线。** 私教人格按孩子解析（全局技能 → 家庭策略 → 孩子级调整），不做成只按家庭。
6. **WorkBuddy 允许改动、允许重新提审。** 但只做增量：新增只读工具、规范版本递进、重新打包提审。现有工具的语义不删不改 —— 没有改动必要，且会破坏已授权家庭。
7. **不自建模型能力。** 不训练自有大模型，不自研 ASR/TTS，不做声纹克隆。
8. **不新写第二套工具集。** 复用现有 MCP 工具（运行时实测 125 个），以进程内 MCP 客户端调用。

## 四、实施步骤

顺序有硬依赖，按序做；每步做完立刻跑测试，不留到最后。

0. **孩子维度教育方式先复核后上线**（代码已就绪、测试通过）：`ChildSkillProfile` 三层解析、`apps/api/src/v2/guards.ts` 统一守卫、MCP 的 `get_child_education_profile` / `update_child_education_profile`、小程序 `child-education` 页、网页端 `ChildEducation.tsx`。复核后随本批迁移一起上线，作为私教人格的取值来源。
1. **数据迁移**：新增 `TutorConversation`、`TutorMessage`、`TutorSafetyEvent` 三张表及其索引（见设计文档第 6 节）。只新增，不动任何现有表与数据。
2. **模型接入**：`apps/api/src/tutor/llm/` 供应商抽象 + 一个实现，跑通流式与工具调用解析。
3. **工具接入**：`mcp-tools.ts`（进程内 MCP 客户端，`InMemoryTransport.createLinkedPair()`）+ `tool-policy.ts`（按模型的工具授权表，默认拒绝）。
4. **人格渲染**：`persona.ts` 从 `FamilyPolicy` / `EducationMethod` / `get_effective_skill` 渲染系统提示词，含第 8 节 L2 五条硬规则。
5. **内容安全**：`safety.ts` 实现 L1 输入侧与 L3 输出侧。
6. **接口**：`routes.ts` 按设计文档第 12 节实现 `/api/tutor/*`，含 SSE 流式与配额。
7. **前端**：`apps/web/src/components/TutorChat.tsx` + `lib/tutor.ts`（SSE 客户端），按 UA 判定是否显示入口。
8. **图片链路**：附件上传走现有 `saveFile()`（MinIO），识别结果落 `TutorMessage.contentJson`。
9. **语音**：`voice/` 抽象 + ASR/TTS 接入 + 前端按住说话。
10. **安卓**：补 `RECORD_AUDIO` 权限、`WebChromeClient.onPermissionRequest`，发新版 APK。
11. **记忆**：`memory.ts` 会话摘要 + 证据回流（写 `EvidenceRecord`，`source: "tutor"`，`reviewStatus: PENDING_CONFIRMATION`）。
12. **实时语音与输出多模态**：双向流；输出先用模板渲染（可打印练习页），不引入自由生图。

## 五、硬约束

**对 WorkBuddy（允许增量改动、允许重新提审）**

- 允许新增只读工具：本期需补 `get_subject_overview`，供私教回答"哪一科要优先处理"。
- 允许 `get_sync_spec` 版本递进（`2.6` → `2.7`，2.6 是孩子维度那批已占用的版本）并追加工作流条目；已有字段语义与 `enums` 取值不改。
- 允许重新打包 Connector / Skill / Expert 并重新提审（因为连接规范变了，包内 `mcp.json` 与 SKILL 文档需同步）。
- 不删除、不改名、不改参数与返回结构的现有工具：这 125 个工具是已授权家庭正在使用的契约。
- 不改 `/mcp`、`/family-edu/mcp` 路径与鉴权方式（`X-MCP-Token` / OAuth Bearer）。
- 不改 nginx 路由：私教挂在 `/api/tutor/*`，落在既有 `/api` 代理内。
- 不扩展 `update_student_question_type_mastery`、`update_wrong_question_status` 的 `source` 枚举（私教不调用这两个工具）。
- 现有测试不得变红，`npm run check:workbuddy` 必须继续通过。

**数据与安全**

- 所有 `/api/tutor/*` 走 `requireAuth`，`familyId` 只从会话取，不接受客户端传入。
- 会话、消息、附件、证据读写前一律校验 `familyId`；跨家庭不可见。
- `childId` 由服务端在会话创建时确定并钉住，运行时**覆盖**模型传入的 `child_id`；同一家庭多个孩子的会话、摘要、证据互不串。
- 证据一律 `PENDING_CONFIRMATION`，家长确认后才进入 `ChildStateSnapshot` 计算；写入前去重，只写孩子确实做过的行为。
- 密钥只进服务器 `.env`，不入库、不提交代码库、不出现在前端。
- 归档会话保留消息但不进入上下文。

**工程**

- 用 `apply_patch` 改代码；不手工重写构建产物。
- `apps/api/dist/` 被 git 跟踪，构建后需一并提交；`apps/web/dist/` 忽略。
- 部署用 rsync 排除 `apps/api/dist`，容器内自己构建。
- 每一步都实际运行测试并留下输出证据，不能只说"改好了"。

## 六、验收清单

**功能**

1. 在安卓 APK 里能看到并打开私教入口；同一地址在桌面浏览器打开不显示入口（调试开除外）。
2. 文字对话流式返回，中途可见逐字输出，不白屏、不卡死。
3. 拍一张真实中文手写作业照片，能识别并围绕孩子**真实存在**的错题讲解。
4. 讲题不给答案、先引导；连续两次不会才逐步给步骤。
5. 按住说话可以录音、识别、回答，并朗读出来。
6. 会话结束产生一条待确认证据，家长在"孩子状态"确认后生效；未确认的不参与计算。
7. 同一家庭两个孩子各自聊天，互相看不到对方的会话、摘要与证据（跨孩子）。
8. 换家庭账号登录，看不到另一家庭的任何会话与数据（跨家庭）。
9. 让私教问"另一个孩子的情况"，应被收敛，不返回兄弟姐妹数据。
10. 人格与严格度跟随家庭设置变化，不需要改代码。

**技术**

11. 单次工具调用轮次上限、单轮超时、工具结果截断生效（默认 6 轮 / 45 秒 / 6KB）。
12. 配额生效：超限返回可读提示，不报 500。
13. 工具白名单默认拒绝：未列出的工具模型看不到也调不到。
14. 模型调用失败降级为可读提示，不留白屏。
15. `TUTOR_ENABLED=false` 时接口返回 503、前端隐藏入口。
16. 没有密钥泄漏：密钥只在服务器 `.env`。

**回归（不得退化）**

17. 现有 API 全部测试通过（不低于 25 文件 131 用例，即当前基线）。
18. 小程序 19 页校验通过。
19. WorkBuddy：`npm run check:workbuddy` 通过；`/family-edu/mcp` 的 `initialize` 与 `tools/list` 正常；现有工具调用行为不变。
20. 桌面与手机三视口无横向溢出、按钮不失效、布局不重叠。
21. 同一家庭两个孩子可设不同教育方式；孩子级未配置时继承家庭级，行为与今天一致。
22. 私教人格跟随孩子设置变化：给哥哥设"严格、少提示"、妹妹设"宽松、多鼓励"，两人的回答风格明显不同。

## 七、交付

1. 数据库迁移在服务器执行成功（`npm run db:deploy`），不损坏现有数据。
2. 部署到 `heyaagent.top` 并做线上验证：网站、`/api/tutor/*`、`/family-edu/mcp` 三者都验。
3. 生成并交付新版 APK（含麦克风权限）。
4. 在 `heyaagent.top` 上实测一轮完整私教流程，留下证据。
5. 提交并推送到 `https://github.com/nightwf/family-edu-agent.git`（main）。
6. 同步更新文档：`README`、`docs/TUTOR_AGENT_DESIGN.md`（补落地状态）、`docs/MCP.md`（如新增只读工具）、`docs/android-app.md`（权限变化）。
7. 重新打包 WorkBuddy 的 Connector / Skill / Expert 三个包并交付可提审的 zip（`npm run check:workbuddy` + `npm run package:workbuddy` 校验通过），包内版本号随规范递进。

## 八、开工前必须定下来的事

**API Key 由 jojo 在联调测试阶段提供**，最后一步真机验证时找他要。写入服务器 `.env` 的 `TUTOR_CHAT_API_KEY`（只进服务器，不入代码库、不入数据库、不出现在页面）。

**因此开发不能等密钥**：第 2 步起按接口写，所有测试用假 provider 打桩（不发真实网络请求），密钥只影响最后一步的线上真机验证。开发期不受阻。

联调时需要向 jojo 要的三项：

1. 豆包 API Key；
2. 可用的对话模型与视觉模型的接入点（Endpoint ID）或模型名；
3. 语音是否已开通 —— 火山控制台的"语音技术"是单独开通的服务，识别与合成各需 App ID / Access Token。

不阻塞开工、可边做边定：

1. 每日配额默认值（当前建议每孩子 60 条消息，家长可配）；
2. 儿童语音原始音频是否留存（当前建议不留存：服务器磁盘已用 80%，语音文件比聊天文本吃盘得多）。

## 九、风险

| 风险 | 说明与应对 |
|---|---|
| 儿童语音识别不达标 | 本期唯一无法靠工程保证的环节。ASR 选型必须用真实儿童录音实测，不达标退化为"按住说话 + 文字确认"。 |
| 模型成本随用量上涨 | 配额前置、按场景选模型、单轮工具结果截断。 |
| 模型被诱导越界 | L1/L3 双审核 + L2 提示词硬规则 + 工具白名单默认拒绝。 |
| 聊天内容变成假证据 | 证据一律待确认，家长确认才生效；写入前按 `childId + type + 时间窗` 去重。 |
| 教学理念两处漂移 | 人格每次从 `FamilyPolicy` / `EducationMethod` 渲染，不落库副本。 |
| 服务器磁盘 80% 已用（31G/40G） | 聊天文本量小，但语音文件若留存会明显吃盘，需先定第 8 节第 2 项。 |
| 单一模型供应商风险 | 全部走豆包：接口不可用或配额受限时私教整体不可用。抽象层保留 `ChatProvider` 接口，必要时可换供应商；本期不做多供应商容灾。 |
| WorkBuddy 重新提审的时间不可控 | 私自教上线与 WorkBuddy 提审解耦：私教不依赖提审结果。规范变更后 WorkBuddy 侧即便晚几天生效，也只是少一个新工作流，不影响已有能力。 |
