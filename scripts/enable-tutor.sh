#!/usr/bin/env bash
# 拿到豆包凭据后，把私教从"关"打开到"线上可用"。
#
# 做四件事，任何一步不通过就停下，不把半配状态留在服务器上：
#   1. 本机先验证 Key + 模型：不支持工具调用的模型直接拒收
#   2. 改服务器 .env（幂等，只动 TUTOR_*，自动备份）
#   3. 重建并重启 api 容器
#   4. 在容器内跑线上校验（含真发一轮对话）
#
# 用法：
#   bash scripts/enable-tutor.sh --key=xxx --chat-model=doubao-seed-1-6-250615
#   bash scripts/enable-tutor.sh --key=xxx --chat-model=m1 --vision-model=m2 --dry-run
#   bash scripts/enable-tutor.sh --disable          # 关掉私教（回滚）
#
# 语音凭据可选（推荐新版控制台的 API Key，一个 Key 覆盖识别与合成）：
#   --voice-api-key= --tts-speaker=        # 最省事：一把 Key + 一个音色
#   --asr-api-key= --tts-api-key= --tts-speaker= [--asr-resource-id=] [--tts-resource-id=] [--tts-speech-rate=]
# 只给其中一栏时，另一栏自动用同一把 Key（识别与合成共用），不会出现半个功能关着。
# 旧版控制台三件套也仍可用：
#   --asr-app-id= --asr-token= --asr-cluster= --tts-app-id= --tts-token= --tts-cluster= --tts-voice=

set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/guanchen_codex_deploy_ed25519}"
HOST="${DEPLOY_HOST:-root@49.234.4.212}"
REMOTE_DIR="${REMOTE_DIR:-/opt/family-edu-agent}"
REMOTE_ENV="$REMOTE_DIR/.env"
CONTAINER="${CONTAINER:-family-edu-agent-api-1}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEY=""; CHAT_MODEL=""; VISION_MODEL=""; BASE_URL=""
ASR_API_KEY=""; ASR_RESOURCE_ID=""; TTS_API_KEY=""; TTS_RESOURCE_ID=""; TTS_SPEAKER=""; TTS_SPEECH_RATE=""
ASR_APP_ID=""; ASR_TOKEN=""; ASR_CLUSTER=""
TTS_APP_ID=""; TTS_TOKEN=""; TTS_CLUSTER=""; TTS_VOICE=""
DRY_RUN=false; DISABLE=false; SKIP_PROBE=false

for arg in "$@"; do
  case "$arg" in
    --key=*) KEY="${arg#*=}" ;;
    --chat-model=*) CHAT_MODEL="${arg#*=}" ;;
    --vision-model=*) VISION_MODEL="${arg#*=}" ;;
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --voice-api-key=*) ASR_API_KEY="${arg#*=}"; TTS_API_KEY="${arg#*=}" ;;
    --asr-api-key=*) ASR_API_KEY="${arg#*=}" ;;
    --asr-resource-id=*) ASR_RESOURCE_ID="${arg#*=}" ;;
    --tts-api-key=*) TTS_API_KEY="${arg#*=}" ;;
    --tts-resource-id=*) TTS_RESOURCE_ID="${arg#*=}" ;;
    --tts-speaker=*) TTS_SPEAKER="${arg#*=}" ;;
    --tts-speech-rate=*) TTS_SPEECH_RATE="${arg#*=}" ;;
    --asr-app-id=*) ASR_APP_ID="${arg#*=}" ;;
    --asr-token=*) ASR_TOKEN="${arg#*=}" ;;
    --asr-cluster=*) ASR_CLUSTER="${arg#*=}" ;;
    --tts-app-id=*) TTS_APP_ID="${arg#*=}" ;;
    --tts-token=*) TTS_TOKEN="${arg#*=}" ;;
    --tts-cluster=*) TTS_CLUSTER="${arg#*=}" ;;
    --tts-voice=*) TTS_VOICE="${arg#*=}" ;;
    --dry-run) DRY_RUN=true ;;
    --disable) DISABLE=true ;;
    --skip-probe) SKIP_PROBE=true ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：${arg}（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

# 火山新版控制台：识别与合成共用同一把 API Key。只填一栏时补另一栏，
# 否则会出现"配了 Key，但语音按钮还是不出现"的怪状态。
if [ -n "$ASR_API_KEY" ] && [ -z "$TTS_API_KEY" ]; then TTS_API_KEY="$ASR_API_KEY"; fi
if [ -n "$TTS_API_KEY" ] && [ -z "$ASR_API_KEY" ]; then ASR_API_KEY="$TTS_API_KEY"; fi

# 新版合成都到这里了却没音色，等于白配：当场说清楚，别等上线后才发现念不出声。
if [ -n "$TTS_API_KEY" ] && [ -z "$TTS_SPEAKER" ] && [ -z "$TTS_VOICE" ]; then
  echo "警告：给了语音 API Key 但没给音色（--tts-speaker=），合成会被判定为未开通。" >&2
fi

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if $DISABLE; then
  say "1/3 关闭私教开关"
  PAIRS=(--set=TUTOR_ENABLED=false)
else
  [ -n "$KEY" ] || { echo "缺少 --key（豆包方舟 API Key）" >&2; exit 2; }
  [ -n "$CHAT_MODEL" ] || { echo "缺少 --chat-model（对话模型 ID）" >&2; exit 2; }

  if ! $SKIP_PROBE; then
    say "1/4 本机验证凭据与模型能力（对话 / 工具调用 / 读图）"
    PROBE_ARGS=(--key="$KEY" --models="$CHAT_MODEL")
    # 允许重复给 --models：脚本会累加，不覆盖
    [ -n "$VISION_MODEL" ] && [ "$VISION_MODEL" != "$CHAT_MODEL" ] && PROBE_ARGS+=(--models="$VISION_MODEL")
    [ -n "$BASE_URL" ] && PROBE_ARGS+=(--base-url="$BASE_URL")
    PROBE_ARGS+=(--vision)
    if ! (cd "$REPO_ROOT" && node scripts/check-doubao-models.mjs "${PROBE_ARGS[@]}"); then
      echo ""
      echo "自检未通过，已中止：没有改动服务器上任何配置。" >&2
      echo "若确要强行配置（例如模型稍后才开通），加 --skip-probe。" >&2
      exit 1
    fi
  else
    say "1/4 跳过凭据自检（--skip-probe）"
  fi

  PAIRS=(--set=TUTOR_ENABLED=true --set=TUTOR_CHAT_API_KEY="$KEY" --set=TUTOR_CHAT_MODEL="$CHAT_MODEL")
  [ -n "$VISION_MODEL" ] && PAIRS+=(--set=TUTOR_VISION_MODEL="$VISION_MODEL")
  [ -n "$BASE_URL" ] && PAIRS+=(--set=TUTOR_CHAT_BASE_URL="$BASE_URL")
  [ -n "$ASR_API_KEY" ] && PAIRS+=(--set=TUTOR_ASR_API_KEY="$ASR_API_KEY")
  [ -n "$ASR_RESOURCE_ID" ] && PAIRS+=(--set=TUTOR_ASR_RESOURCE_ID="$ASR_RESOURCE_ID")
  [ -n "$TTS_API_KEY" ] && PAIRS+=(--set=TUTOR_TTS_API_KEY="$TTS_API_KEY")
  [ -n "$TTS_RESOURCE_ID" ] && PAIRS+=(--set=TUTOR_TTS_RESOURCE_ID="$TTS_RESOURCE_ID")
  [ -n "$TTS_SPEAKER" ] && PAIRS+=(--set=TUTOR_TTS_SPEAKER="$TTS_SPEAKER")
  [ -n "$TTS_SPEECH_RATE" ] && PAIRS+=(--set=TUTOR_TTS_SPEECH_RATE="$TTS_SPEECH_RATE")
  [ -n "$ASR_APP_ID" ] && PAIRS+=(--set=TUTOR_ASR_APP_ID="$ASR_APP_ID")
  [ -n "$ASR_TOKEN" ] && PAIRS+=(--set=TUTOR_ASR_ACCESS_TOKEN="$ASR_TOKEN")
  [ -n "$ASR_CLUSTER" ] && PAIRS+=(--set=TUTOR_ASR_CLUSTER="$ASR_CLUSTER")
  [ -n "$TTS_APP_ID" ] && PAIRS+=(--set=TUTOR_TTS_APP_ID="$TTS_APP_ID")
  [ -n "$TTS_TOKEN" ] && PAIRS+=(--set=TUTOR_TTS_ACCESS_TOKEN="$TTS_TOKEN")
  [ -n "$TTS_CLUSTER" ] && PAIRS+=(--set=TUTOR_TTS_CLUSTER="$TTS_CLUSTER")
  [ -n "$TTS_VOICE" ] && PAIRS+=(--set=TUTOR_TTS_VOICE_TYPE="$TTS_VOICE")
fi

say "2/4 写入服务器 .env（幂等，自动备份为 .env.bak）"
scp -q -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no \
  "$REPO_ROOT/scripts/upsert-env.mjs" "$HOST:/tmp/upsert-env.mjs"
REMOTE_CMD="node /tmp/upsert-env.mjs --file=$REMOTE_ENV ${PAIRS[*]}"
if $DRY_RUN; then
  ssh "${SSH_OPTS[@]}" "$HOST" "$REMOTE_CMD --dry-run"
  say "dry-run 结束，未改动线上。"
  exit 0
fi
ssh "${SSH_OPTS[@]}" "$HOST" "$REMOTE_CMD"

say "3/4 同步 compose 配置并重建 api 容器"
# compose 决定哪些变量进容器，本地改了必须同步过去，否则重启也白搭
scp -q -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no "$REPO_ROOT/docker-compose.yml" "$HOST:$REMOTE_DIR/docker-compose.yml"
ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build api >/dev/null && docker compose ps api"

# 只改 .env 是不够的：compose 的 environment 段是白名单，没列进去的变量不会进容器。
# 这里直接问容器要值，把"配置看着对、实际没生效"这类问题挡在这一步。
say "3.5/4 确认容器真的收到了这些变量"
if $DISABLE; then EXPECT_ENABLED=false; else EXPECT_ENABLED=true; fi
IN_CONTAINER=$(ssh "${SSH_OPTS[@]}" "$HOST" "docker exec $CONTAINER printenv TUTOR_ENABLED || true")
if [ "$IN_CONTAINER" != "$EXPECT_ENABLED" ]; then
  echo "" >&2
  echo "容器里的 TUTOR_ENABLED=${IN_CONTAINER:-（空）}，期望 ${EXPECT_ENABLED}。" >&2
  echo "多半是 docker-compose.yml 的 environment 段没有列出 TUTOR_* —— 只改 .env 不会进容器。" >&2
  echo "请先补上 docker-compose.yml 再重试。" >&2
  exit 1
fi
if ! $DISABLE; then
  CHAT_MODEL_IN=$(ssh "${SSH_OPTS[@]}" "$HOST" "docker exec $CONTAINER printenv TUTOR_CHAT_MODEL || true")
  KEY_LEN=$(ssh "${SSH_OPTS[@]}" "$HOST" "docker exec $CONTAINER sh -c 'printf %s \"\$TUTOR_CHAT_API_KEY\" | wc -c' | tr -d ' '")
  echo "  TUTOR_ENABLED=$IN_CONTAINER  TUTOR_CHAT_MODEL=$CHAT_MODEL_IN  TUTOR_CHAT_API_KEY=${KEY_LEN} 字符"
  [ -n "$CHAT_MODEL_IN" ] || { echo "TUTOR_CHAT_MODEL 为空，已在容器内生效失败，中止。" >&2; exit 1; }
  [ "${KEY_LEN:-0}" -gt 0 ] || { echo "TUTOR_CHAT_API_KEY 为空，已在容器内生效失败，中止。" >&2; exit 1; }
fi

say "4/4 等健康检查稳定（容器重建瞬间会有短暂 502）"
ok=0
for attempt in 1 2 3 4 5 6 7 8; do
  sleep 4
  if ssh "${SSH_OPTS[@]}" "$HOST" "curl -fsS -o /dev/null http://127.0.0.1:4100/api/health"; then
    ok=$((ok + 1))
    echo "  第 $attempt 次：健康"
    [ "$ok" -ge 2 ] && break
  else
    ok=0
    echo "  第 $attempt 次：还没起来"
  fi
done
[ "$ok" -ge 2 ] || { echo "健康检查未稳定，请手动查看容器日志：docker logs $CONTAINER --tail 100" >&2; exit 1; }

say "线上校验：MCP 工具清单 + /api/tutor/* + 真发一轮对话"
# 校验脚本从本机带过去，不依赖服务器仓库是否刚同步过
scp -q -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no \
  "$REPO_ROOT/scripts/verify-online.mjs" "$REPO_ROOT/scripts/lib/sse-parse.mjs" "$HOST:/tmp/"
# verify-online.mjs 用相对路径导入 lib/sse-parse.mjs，两者要保持同一目录结构
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec $CONTAINER mkdir -p /app/.verify/lib && docker cp /tmp/verify-online.mjs $CONTAINER:/app/.verify/verify-online.mjs && docker cp /tmp/sse-parse.mjs $CONTAINER:/app/.verify/lib/sse-parse.mjs"
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec -e BASE_URL=http://127.0.0.1:4100 $CONTAINER node /app/.verify/verify-online.mjs --roundtrip"

say "行为验证：讲题不给答案 / 问到兄弟姐妹要收回（真模型，只读数据）"
scp -q -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=no \
  "$REPO_ROOT/scripts/verify-tutor-behavior.mjs" "$HOST:/tmp/"
ssh "${SSH_OPTS[@]}" "$HOST" "docker cp /tmp/verify-tutor-behavior.mjs $CONTAINER:/app/.verify/verify-tutor-behavior.mjs && docker exec $CONTAINER node /app/.verify/verify-tutor-behavior.mjs"

echo ""
echo "完成。若上面 roundTrip 里 textLength 大于 0，说明模型真的在回答。"
