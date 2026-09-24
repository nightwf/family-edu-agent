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
# 语音凭据可选：
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
ASR_APP_ID=""; ASR_TOKEN=""; ASR_CLUSTER=""
TTS_APP_ID=""; TTS_TOKEN=""; TTS_CLUSTER=""; TTS_VOICE=""
DRY_RUN=false; DISABLE=false; SKIP_PROBE=false

for arg in "$@"; do
  case "$arg" in
    --key=*) KEY="${arg#*=}" ;;
    --chat-model=*) CHAT_MODEL="${arg#*=}" ;;
    --vision-model=*) VISION_MODEL="${arg#*=}" ;;
    --base-url=*) BASE_URL="${arg#*=}" ;;
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

say "3/4 重建并重启 api 容器"
ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build api >/dev/null && docker compose ps api"

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
# verify-online.mjs 用相对路径导入 lib/sse-parse.mjs，所以两者要保持同一目录结构
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec $CONTAINER mkdir -p /app/.verify/lib && docker cp '$REMOTE_DIR/scripts/verify-online.mjs' $CONTAINER:/app/.verify/verify-online.mjs && docker cp '$REMOTE_DIR/scripts/lib/sse-parse.mjs' $CONTAINER:/app/.verify/lib/sse-parse.mjs"
ssh "${SSH_OPTS[@]}" "$HOST" "docker exec -e BASE_URL=http://127.0.0.1:4100 $CONTAINER node /app/.verify/verify-online.mjs --roundtrip"

echo ""
echo "完成。若上面 roundTrip 里 textLength 大于 0，说明模型真的在回答。"
