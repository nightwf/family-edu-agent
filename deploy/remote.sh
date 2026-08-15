#!/usr/bin/env bash
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/guanchen_codex_deploy_ed25519}"
HOST="${DEPLOY_HOST:-root@49.234.4.212}"
REMOTE_DIR="${REMOTE_DIR:-/opt/family-edu-agent}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)

rsync -az \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude '.git' \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "$HOST:$REMOTE_DIR/"

ssh "${SSH_OPTS[@]}" "$HOST" "systemctl restart family-edu-agent && systemctl status family-edu-agent --no-pager -l | head -25"
