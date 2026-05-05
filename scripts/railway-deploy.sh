#!/usr/bin/env bash
# One-shot Railway setup: env vars + volume + domain. Idempotent (re-runnable).
# Requires RAILWAY_TOKEN in env (project-scoped).
set -e

PROJECT_ID="fe842ed3-e6b1-48ea-9789-27c0da79c338"
ENV_ID="bbe95251-e54c-43a1-994f-01521be88338"
SERVICE_ID="549eb6b9-71d7-4dfc-a5ea-69dc73cc5726"
GQL="https://backboard.railway.com/graphql/v2"

if [ -z "$RAILWAY_TOKEN" ]; then echo "RAILWAY_TOKEN not set" >&2; exit 1; fi

# Helper: GraphQL request
gql() {
  curl -sS -X POST "$GQL" \
    -H "Project-Access-Token: $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$1"
}

# Helper: set one var
set_var() {
  local name="$1"; local val="$2"
  # Escape backslashes + double quotes for JSON.
  val_esc=$(printf '%s' "$val" | python -c "import sys,json; print(json.dumps(sys.stdin.read()))")
  gql "{\"query\":\"mutation { variableUpsert(input: { projectId: \\\"$PROJECT_ID\\\", environmentId: \\\"$ENV_ID\\\", serviceId: \\\"$SERVICE_ID\\\", name: \\\"$name\\\", value: $val_esc }) }\"}" \
    | python -c "import sys,json; d=json.load(sys.stdin); print('  ' + ('OK' if d.get('data',{}).get('variableUpsert') else 'ERR ' + json.dumps(d.get('errors', []))))"
}

# Read .env locally and push every non-comment line.
echo "[deploy] uploading env vars from .env..."
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in
    \#*) continue ;;
    RAILWAY_TOKEN) continue ;;  # don't push the deploy token into the runtime env
  esac
  # Trim leading/trailing whitespace.
  key_clean=$(echo "$key" | tr -d ' ')
  [ -z "$key_clean" ] && continue
  echo "  $key_clean"
  set_var "$key_clean" "$value"
done < .env

echo "[deploy] creating persistent volume /app/agent-state..."
gql "{\"query\":\"mutation { volumeCreate(input: { projectId: \\\"$PROJECT_ID\\\", environmentId: \\\"$ENV_ID\\\", serviceId: \\\"$SERVICE_ID\\\", mountPath: \\\"/app/agent-state\\\" }) { id } }\"}" \
  | python -c "import sys,json; d=json.load(sys.stdin); v=d.get('data',{}).get('volumeCreate'); print('  OK volume ' + v['id'] if v else '  (already exists or: ' + json.dumps(d.get('errors',[]))[:200] + ')')"

echo "[deploy] generating service domain..."
gql "{\"query\":\"mutation { serviceDomainCreate(input: { serviceId: \\\"$SERVICE_ID\\\", environmentId: \\\"$ENV_ID\\\", targetPort: 8080 }) { domain } }\"}" \
  | python -c "import sys,json; d=json.load(sys.stdin); v=d.get('data',{}).get('serviceDomainCreate'); print('  domain: ' + v['domain'] if v else '  (already exists or: ' + json.dumps(d.get('errors',[]))[:200] + ')')"

echo "[deploy] triggering initial deployment..."
gql "{\"query\":\"mutation { serviceInstanceDeployV2(serviceId: \\\"$SERVICE_ID\\\", environmentId: \\\"$ENV_ID\\\") }\"}" \
  | python -c "import sys,json; d=json.load(sys.stdin); v=d.get('data',{}).get('serviceInstanceDeployV2'); print('  deployment id: ' + str(v) if v else '  (no deploy: ' + json.dumps(d.get('errors',[]))[:200] + ')')"

echo "[deploy] done."
