"""Push every env var from .env into the Railway service. Idempotent."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ID  = "fe842ed3-e6b1-48ea-9789-27c0da79c338"
ENV_ID      = "bbe95251-e54c-43a1-994f-01521be88338"
SERVICE_ID  = "549eb6b9-71d7-4dfc-a5ea-69dc73cc5726"
GQL         = "https://backboard.railway.com/graphql/v2"

# Vars we never push to the deployed service (deployment-only credentials).
SKIP = {"RAILWAY_TOKEN", "RAILWAY_API_TOKEN"}

def gql(query: str, token: str) -> dict:
    req = urllib.request.Request(
        GQL,
        data=json.dumps({"query": query}).encode("utf-8"),
        headers={
            "Project-Access-Token": token,
            "Content-Type": "application/json",
            "User-Agent": "runcor-deploy/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"errors": [{"message": f"HTTP {e.code}: {body[:300]}"}]}

def upsert_batch(pairs: list[tuple[str, str]], token: str) -> bool:
    """Single batched mutation: one redeploy for all vars."""
    variables_obj = {k: v for k, v in pairs}
    # GraphQL JSON: serialize the dict as a JSON object literal embedded in the query.
    obj_literal = json.dumps(variables_obj)
    q = (
        "mutation($input: VariableCollectionUpsertInput!) "
        "{ variableCollectionUpsert(input: $input) }"
    )
    req = urllib.request.Request(
        GQL,
        data=json.dumps({
            "query": q,
            "variables": {
                "input": {
                    "projectId": PROJECT_ID,
                    "environmentId": ENV_ID,
                    "serviceId": SERVICE_ID,
                    "variables": json.loads(obj_literal),
                    "replace": False,
                },
            },
        }).encode("utf-8"),
        headers={
            "Project-Access-Token": token,
            "Content-Type": "application/json",
            "User-Agent": "runcor-deploy/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            r = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            r = json.loads(body)
        except json.JSONDecodeError:
            r = {"errors": [{"message": f"HTTP {e.code}: {body[:300]}"}]}
    if r.get("errors"):
        msg = r["errors"][0].get("message", "?")
        print(f"  FAIL batch: {msg}".encode("ascii", "replace").decode())
        return False
    return True

def parse_env(path: Path) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k in SKIP:
            continue
        out.append((k, v.strip()))
    return out

def main() -> int:
    token = os.environ.get("RAILWAY_TOKEN")
    if not token:
        print("RAILWAY_TOKEN not set", file=sys.stderr)
        return 1
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        print(f"missing {env_path}", file=sys.stderr)
        return 1
    pairs = parse_env(env_path)
    print(f"[deploy] batched-upsert of {len(pairs)} env vars (one redeploy)")
    for k, _ in pairs:
        print(f"  - {k}")
    ok = upsert_batch(pairs, token)
    print(f"[deploy] {'OK' if ok else 'FAIL'}")
    _ = time  # keep import used
    return 0 if ok else 2

if __name__ == "__main__":
    sys.exit(main())
