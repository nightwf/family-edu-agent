# 豆包（火山方舟）+ 火山语音 开通清单

给私教配真实模型用。分两块：**模型（必须）**、**语音（可选，但按住说话要用）**。
控制台按钮文案会随版本调整，路径以「账号中心」实际显示为准；模型 ID 一律以控制台页面上显示的字符串为准，不要凭记忆拼。

---

## 一、模型：火山方舟（Ark）

### 1. 准备

| 项 | 说明 |
|---|---|
| 账号 | 火山引擎账号（volcengine.com）。用你已有的阿里云账号是**不通**的，需要单独注册 |
| 实名认证 | **必须**。个人或企业认证都行，未实名调用会返回 403 |
| 计费 | 按 token 计费。每个模型通常有一次性免费额度（几十万 token），额度用完必须充值，否则报「余额不足」 |

### 2. 要开通哪几个模型

私教运行时**必须**用到两类能力，看清再开通，少一个就会缺功能：

| 能力 | 是否必须 | 用在哪 | 少了会怎样 |
|---|---|---|---|
| 对话模型（**且支持工具调用**） | **必须** | 所有对话；运行时给它挂 30 个只读工具（家长侧 38 个），用来读孩子档案、错题、掌握度、教育理念 | 不支持工具调用的模型**不会报错**，只会查不到任何孩子数据、凭空空谈。这是最难发现的坑 |
| 视觉模型 | 拍图讲错题必须，纯文字对话不需要 | 孩子拍手写作业照片识题 | 只能发文字，发图会失败 |
| 语音合成 / 语音识别 | 可选 | 朗读回答、按住说话 | 语音按钮隐藏，文字对话不受影响。且**不是方舟的模型**，要去「语音技术」单独开通（见第二节） |

**推荐开一个多模态模型一次搞定前两项**：`doubao-seed-1-6` 这类同时支持工具调用和读图的型号，
`TUTOR_CHAT_MODEL` 与 `TUTOR_VISION_MODEL` 填同一个 ID 即可。
如果分开开，就一个对话模型 + 一个 `doubao-1-5-vision-*` 视觉模型。

不需要开通的：Embedding / 向量模型（当前没有语义检索，见下）、内容审核服务（三层安全是内置逻辑）、语音模型（在「语音技术」里，不在方舟）。

### 3. 三件事，顺序不能颠倒

1. **开通模型**：控制台进「火山方舟」→「开通管理」，勾选要用的模型并同意条款。
   只创建 API Key 不开通模型，调用会返回「模型未开通」。
2. **创建 API Key**：方舟 →「API Key 管理」→ 创建。得到一个 `sk-` 开头的串（旧账号可能是随机串）。
   这个值就是 `.env` 里的 `TUTOR_CHAT_API_KEY`。**只显示一次，当场复制。**
3. **拿到模型标识**：有两种写法，二选一，代码两种都支持：
   - 直接填**模型 ID**：在「开通管理」或「在线推理」页面能看到，形如 `doubao-seed-1-6-250615`；
   - 或先建**推理接入点**，拿 `ep-` 开头的 ID（形如 `ep-20260xxx-xxxxx`）。

### 4. 拿到 Key 之后先自检

```bash
TUTOR_CHAT_API_KEY=你复制的key npm run check:doubao
```

只发最小请求，费用可忽略。它会**三项都验**（对话 / 工具调用 / 读图）：

- 报出 Key 是否有效（401 / 403 / 余额不足都会翻成人话）；
- 逐个试常见模型 ID，告诉你哪些真的能调；
- **验证工具调用**：挂一个探活工具，看模型是主动发起 `tool_call`，还是直接编一段文字。
  只有能调工具的模型才会被推荐；只能对话的模型会单独列出来并明确标注"不能给私教用"；
- 最后直接吐出行 `.env` 该写成什么。

也可以只测你抄下来的 ID，并顺手验证读图：

```bash
npm run check:doubao -- --key=你的key --models=doubao-seed-1-6-250615 --vision
```

### 5. 要填进服务器 `.env` 的项

只填这几项即可（其余用默认值）：

| 变量 | 值 |
|---|---|
| `TUTOR_ENABLED` | `true`（配好后由我打开；开着但没 Key 会返回 503） |
| `TUTOR_CHAT_API_KEY` | 方舟 API Key |
| `TUTOR_CHAT_MODEL` | 对话模型 ID |
| `TUTOR_VISION_MODEL` | 视觉模型 ID（拍图讲错题用） |
| `TUTOR_CHAT_BASE_URL` | 不填默认 `https://ark.cn-beijing.volces.com/api/v3`，账号在北京区就不用管 |

**注意：这些变量必须同时出现在 `docker-compose.yml` 的 `environment:` 里才会进容器。**
compose 那一段是白名单，只往 `.env` 里写值是不生效的（曾因此让 `TUTOR_ENABLED=true` 无效、
接口一直 503，看着像凭据问题）。`enable-tutor.sh` 会替你把 compose 同步过去，并在重启后
直接向容器查值做确认，不通过就中止。

配额与超时都有默认值，可按需覆盖：
`TUTOR_DAILY_MESSAGE_LIMIT`（默认 60 条/孩子/天）、`TUTOR_DAILY_TOKEN_LIMIT`（默认 0 即不限）、
`TUTOR_MAX_TOOL_ROUNDS`（6）、`TUTOR_REQUEST_TIMEOUT_MS`（45000）、`TUTOR_TOOL_RESULT_LIMIT`（6000）。

**内容审核不需要额外开通**：私教的三层安全（输入规则、人格硬规则、输出校验）都是内置逻辑，不走第三方审核服务，`TUTOR_MODERATION_ENABLED` 保持默认即可。

**也不需要向量库/Embedding**：当前知识检索走的是结构化字段与关键词；`TECHNICAL_DESIGN_V2.md` 已把「向量检索」明确列为本轮未纳入，所以现在没有要开通的向量模型。

### 6. 配到线上（一条命令）

上面那些变量不需要手工去服务器上编辑，用这个脚本替代：

```bash
# 先预览会写什么（不落盘、不动线上）
bash scripts/enable-tutor.sh --key=xxx --chat-model=doubao-seed-1-6-250615 --dry-run

# 确认无误后真正执行
bash scripts/enable-tutor.sh --key=xxx --chat-model=doubao-seed-1-6-250615
```

它按顺序做四件事，任何一步不过就停下、不把半配状态留在服务器上：

1. **先在本机验证 Key 与模型**：对话、工具调用、读图三项都要过；不支持工具调用的模型直接拒收；
2. **改服务器 `.env`**：只动 `TUTOR_*`，幂等（重复执行结果一致），自动备份成 `.env.bak`；
3. **重建并重启 api 容器**，等健康检查连续通过（容器重建瞬间会有短暂 502，属正常）；
4. **在容器内跑线上校验**，含真发一轮对话，报告文本长度、工具调用与错误。

语音凭据一起给的话直接追加参数即可：

```bash
# 新版：一把 API Key + 一个音色 ID（最省事，两栏自动都填同一把 Key）
bash scripts/enable-tutor.sh --key=xxx --chat-model=m1 \
  --voice-api-key=xxx --tts-speaker=zh_female_vv_uranus_bigtts

# 等价写法：分别给两栏（只给其中一栏时，另一栏会自动用同一把 Key）
bash scripts/enable-tutor.sh --key=xxx --chat-model=m1 \
  --tts-api-key=xxx --tts-speaker=zh_female_vv_uranus_bigtts

# 旧版控制台的三件套（与新版二选一）
bash scripts/enable-tutor.sh --key=xxx --chat-model=m1 \
  --asr-app-id= --asr-token= --asr-cluster= \
  --tts-app-id= --tts-token= --tts-cluster= --tts-voice=
```

想回滚（关闭私教、回到"入口隐藏 + 503"）：`bash scripts/enable-tutor.sh --disable`。

---

## 二、语音：火山引擎「语音技术」

**这是和方舟分开的产品，Key 不通用**，要单独开通。不开通的表现是：语音按钮隐藏、接口返回 503，文字对话不受影响。

### 0. 先看清"很多模型"里只要哪两个

「语音技术」页面下的模型列表很长（流式识别、录音文件识别、实时对话、多种音色……），
**私教只用到下面两项**，其余一律不用开：

| 要开的 | 私教用在哪 | 代码实际调用的接口 |
|---|---|---|
| **语音合成（大模型）** | 把回答念出来 | `openspeech.bytedance.com/api/v3/tts/unidirectional`，资源标识 `seed-tts-2.0`，需要一把 `X-Api-Key` + 一个音色 ID |
| **录音文件识别（极速版）** | 孩子「按住说话」把一段录音转文字 | `openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash`，资源标识 `volc.bigasr.auc_turbo` |

不要开的：**流式语音识别**（WebSocket 协议，和上面的 HTTP 极速版不是同一个接口，
代码没走它）、**实时对话式 AI / 端到端语音大模型**（那是另一套协议，本项目的编排在
我方服务端，不需要它）、方舟里的 Embedding / 内容审核。

判断标准很简单：本项目是「孩子说完一整段再上传识别」，不是边说话边识别，
所以只要能做**录音文件识别**的型号就够了。

**注意别点错的那一个**：识别类目下还有「录音文件识别（标准版）」——那是**异步**接口
（先 submit 拿 task id，再轮询查询），本项目没走它。认准「极速版」四个字，
极速版是同步返回、不用轮询的。

### 1. 准备

**首选新版控制台的 API Key**（推荐，官方文档明确旧版控制台后续会下线）：

1. 控制台进「语音技术」，开通上面那两项服务；
2. 「API Key 管理 / 访问控制」里创建一把 **API Key**。
   **一把 Key 同时覆盖识别与合成**，不用去凑 App ID / Access Token / Cluster 三件套，
   也不用给识别和合成各建应用；
3. 到「音色库」里抄一个**音色 ID**（形如 `zh_female_vv_uranus_bigtts`），给合成用。

> 已与控制台确认：识别与合成**共用同一把 Key**。所以代码与配置脚本都按"填一栏等于两栏"处理，
> 不会出现"Key 配了、但语音按钮还是不出现"的半开通状态。真出现两把不同的 Key 也能分别填，各用各的。

只有在新版控制台找不到入口、或账号是老版时，才走下面的**旧版三件套**（代码两条路都兼容）：

1. 控制台进「语音技术」，**创建应用**；
2. 应用里能看到三样凭据：`App ID`、`Access Token`、`Secret Key`；
3. 分别开通两项服务：
   - **语音合成（TTS）** —— 私教把回答念出来；
   - **语音识别（ASR）** —— 孩子按住说话转文字。

### 2. 要填的项

新版 API Key 只需要三项：

| 变量 | 用途 |
|---|---|
| `TUTOR_TTS_API_KEY` | 语音合成的 API Key（新版控制台） |
| `TUTOR_TTS_SPEAKER` | 音色 ID，从控制台「音色库」抄，填错会报"音色不存在" |
| `TUTOR_ASR_API_KEY` | 语音识别的 API Key（与上面是同一把） |

`TUTOR_TTS_RESOURCE_ID`（默认 `seed-tts-2.0`）与 `TUTOR_ASR_RESOURCE_ID`
（默认 `volc.bigasr.auc_turbo`）保持默认即可，一般不用改。

旧版三件套的项（仅在走旧版控制台时才填，与上面的 Key 二选一即可）：

| 变量 | 用途 |
|---|---|
| `TUTOR_ASR_APP_ID` | 识别：App ID |
| `TUTOR_ASR_ACCESS_TOKEN` | 识别：Access Token |
| `TUTOR_ASR_CLUSTER` | 识别：资源标识。填错是最常见的失败原因 |
| `TUTOR_TTS_APP_ID` | 合成：App ID |
| `TUTOR_TTS_ACCESS_TOKEN` | 合成：Access Token |
| `TUTOR_TTS_CLUSTER` | 合成：集群/服务标识 |
| `TUTOR_TTS_VOICE_TYPE` | 音色 ID（孩子用的音色，建议挑偏温和的） |

`TUTOR_ASR_CLUSTER` / `TUTOR_TTS_CLUSTER` / `TUTOR_TTS_VOICE_TYPE` 三个值**必须从你开通的那个服务的文档页抄**，
代码里的适配（`apps/api/src/tutor/voice/volcengine.ts`）按火山文档写的，但没有真实凭据跑过，这三个值极可能要按你的实际开通项微调。

合成还支持一个可选值 `TUTOR_TTS_SPEECH_RATE`（默认 `0` 即原速，范围约 -50~100），
嫌念得太快可以调成负数。

### 2.5 拿到凭据先跑自检（合成一句再识别回来）

新版 API Key（推荐）：

```bash
npm run check:voice -- --api-key=xxx --speaker=zh_female_vv_uranus_bigtts
```

旧版三件套：

```bash
npm run check:voice -- --asr-app-id=xxx --asr-token=xxx --asr-cluster=volc.bigasr.auc_turbo \
                     --tts-app-id=xxx --tts-token=xxx --tts-cluster=xxx --tts-voice=xxx
```

它做的是一圈**闭环**：先合成一句「今天我们一起把这道题弄明白」，再把这段音频回灌给识别，
比对读回来的字。这一圈过了，等于同时证明**凭据、资源标识、音色三样全对**，
而不是"单个接口没报错"。

火山语音有个坑：**业务错误常常是 HTTP 200，正文里才带 `code`/`message`**；
识别失败时正文甚至可能是空对象，真正的 `code` 在响应头里。自检脚本两种情况都会把
**上游原始 code 与 message 原样打出来**，并给出对应的处置动作（凭据 / cluster / 音色 / 开通 / 配额），
不用靠猜。服务端实现里也做了同样的透出。

### 3. 这一块的已知风险

儿童语音识别准确率明显低于成人，这是整个私教里**唯一无法靠工程保证**的环节。
开通后我会用 JOJO 的真实录音实测；不达标就退化成「按住说话 + 文字确认」，不阻塞其他功能。

---

## 三、语音文件是否留存

默认**不留存**原始录音（只存识别后的文字）。服务器磁盘已用 83%（31G/40G），
录音文件比聊天文本吃盘得多。需要留存的话再单独定。

---

## 四、给 jojo 的最短路径

1. 注册火山引擎 + 实名认证；
2. 方舟里开通一个对话模型（建议选带 vision 的多模态型号，省一次开通）+ 创建 API Key；
3. 跑 `npm run check:doubao -- --key=xxx --vision`，把输出的三行发我（**工具调用那一栏必须是 ✅**）；
4. 我执行 `bash scripts/enable-tutor.sh --key=xxx --chat-model=xxx`（含验证、配置、重启、线上对话校验），然后我们一起在 APK 里真机跑一遍；
5. 语音想一起上，再去「语音技术」开通**语音合成（大模型）**与**录音文件识别（极速版）**，
   建一把 API Key 并抄一个音色 ID，把这两个值给我就够（不用给 App ID / Access Token）。

### 已经准备好的自动化

| 工具 | 作用 |
|---|---|
| `npm run check:doubao` | 凭据与模型能力自检（对话 / 工具调用 / 读图） |
| `npm run check:voice` | 语音凭据自检（合成一句 → 回灌识别 → 比对），新旧两种鉴权都支持 |
| `bash scripts/enable-tutor.sh` | 一条命令完成：验证 → 写 `.env` → 重启 → 线上校验；`--dry-run` 可预演，`--disable` 可回滚 |
| `scripts/verify-online.mjs --roundtrip` | 线上真发一轮对话，直接报文本长度、工具调用、错误；验证用会话会自动归档 |
| `npm run test:ops` | 上面这些运维脚本自身的用例（.env 写入 17 项 + SSE 解析 11 项 + 接口结构 7 项 + 语音报错翻人话 11 项 + compose 白名单一致性） |
