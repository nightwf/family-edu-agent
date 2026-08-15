#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/family-edu-agent/backups}"
mkdir -p "$BACKUP_DIR"

timestamp=$(date +%Y%m%d-%H%M%S)
file="$BACKUP_DIR/family_edu_${timestamp}.sql.gz"

docker compose exec -T db pg_dump -U family_edu -d family_edu | gzip > "$file"

find "$BACKUP_DIR" -name 'family_edu_*.sql.gz' -mtime +14 -delete

echo "$file"
