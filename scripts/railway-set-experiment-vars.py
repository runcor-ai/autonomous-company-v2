"""Set CONTROL_BUDGET_USD=5 + RESET_ON_BOOT=true via batched upsert."""
import json, os, sys, urllib.error, urllib.request

PROJECT_ID = "fe842ed3-e6b1-48ea-9789-27c0da79c338"
ENV_ID     = "bbe95251-e54c-43a1-994f-01521be88338"
SERVICE_ID = "549eb6b9-71d7-4dfc-a5ea-69dc73cc5726"
GQL        = "https://backboard.railway.com/graphql/v2"

token = os.environ["RAILWAY_TOKEN"]
vars_to_set = {"CONTROL_BUDGET_USD": "5", "RESET_ON_BOOT": "true"}

req = urllib.request.Request(
    GQL,
    data=json.dumps({
        "query": "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
        "variables": {"input": {
            "projectId": PROJECT_ID, "environmentId": ENV_ID, "serviceId": SERVICE_ID,
            "variables": vars_to_set, "replace": False,
        }},
    }).encode(),
    headers={"Project-Access-Token": token, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as resp:
    print(json.loads(resp.read().decode("utf-8")))
