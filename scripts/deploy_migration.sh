#!/usr/bin/env bash
# deploy_migration.sh — deploy a SQL migration via Supabase Management API
# Usage: SUPABASE_ACCESS_TOKEN=<token> bash scripts/deploy_migration.sh <sql_file>
set -euo pipefail

SQL_FILE="${1:-}"
PROJECT_REF="bdzcydhrdjprdzywjbeu"
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"

if [[ -z "$SQL_FILE" ]]; then
  echo "Usage: SUPABASE_ACCESS_TOKEN=<token> bash scripts/deploy_migration.sh <path/to/file.sql>"
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  echo "Error: SUPABASE_ACCESS_TOKEN environment variable is not set."
  exit 1
fi

if [[ ! -f "$SQL_FILE" ]]; then
  echo "Error: SQL file not found: $SQL_FILE"
  exit 1
fi

echo "→ Encoding SQL payload…"
PAYLOAD=$(python3 - <<'PYEOF'
import sys, json
sql = open(sys.argv[1]).read()
print(json.dumps({"query": sql}))
PYEOF
"$SQL_FILE")

echo "→ Sending to Supabase (project: $PROJECT_REF)…"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_BODY=$(echo "$RESPONSE" | head -n -1)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

echo "→ HTTP $HTTP_CODE"
echo "$HTTP_BODY" | python3 -m json.tool 2>/dev/null || echo "$HTTP_BODY"

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✓ Migration deployed successfully."
else
  echo "✗ Deployment failed (HTTP $HTTP_CODE)."
  exit 1
fi
