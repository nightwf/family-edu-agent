#!/usr/bin/env bash
set -euo pipefail

base="${BASE_URL:-http://49.234.4.212/family-edu}"
token="${MCP_TOKEN:-family-edu-2026}"

response=$(curl -sS --max-time 15 \
  -X POST "$base/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-MCP-Token: $token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}')

if ! grep -q "family-edu-mcp" <<< "$response"; then
  echo "MCP smoke test failed: $response"
  exit 1
fi

echo "MCP smoke test passed"
