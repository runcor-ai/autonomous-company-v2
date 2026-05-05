# Deploy: autonomous-company-v2

End-to-end checklist for Phase 6 — Railway + DNS + experiment start.

---

## 0. Prerequisites checklist

- [x] **Railway account** — runcor signed up via runcor-ai GitHub
- [x] **OpenRouter key** — `OPENROUTER_API_KEY` (covers V2 + control + rater)
- [x] **Firecrawl key** — `FIRECRAWL_API_KEY` (web_search sense)
- [x] **runner@runcor.ai email** — `RUNNER_EMAIL_PASSWORD` (provided)
- [x] **Operator auth token** — `OPERATOR_AUTH_TOKEN` (auto-generated, in `.env`)
- [ ] **GitHub PAT for v2-workspace** — `GIT_PUSH_TOKEN`. **STILL NEEDED.** Create at github.com/settings/tokens → Fine-grained → "v2-workspace push": only `runcor-ai/v2-workspace`, Contents = read+write.

The good/evil rater rides on OpenRouter (`anthropic/claude-3.5-sonnet` by default — overrideable via `RATER_MODEL`). No separate Anthropic key required.

Web search uses Firecrawl `/v1/search` — markdown-clean snippets in the same provider shape as Brave (no code changes needed if you switch back later).

---

## 1. Build the parent monorepo for the Docker context

The repo's `package.json` uses `file:../runcor-X` deps. The Dockerfile assumes the build context contains `autonomous-company-v2/` AND each sibling at the same level. Set up the build dir:

```bash
# Locally — staging the build context
mkdir -p /tmp/runcor-build
cp -r /c/runcor\ May\ 3\ 2026/autonomous-company-v2 /tmp/runcor-build/
for sib in runcor-coherence runcor-dialectic runcor-drives runcor-goals \
           runcor-identity runcor-meta runcor-skills runcor-temporal \
           runcor-watchdog rpp-parser; do
  cp -r "/c/runcor May 3 2026/$sib" "/tmp/runcor-build/"
done
cd /tmp/runcor-build && docker build -f autonomous-company-v2/Dockerfile -t v2:local .
```

For Railway, this monorepo bundling is harder — see §3.

---

## 2. Preflight (local — verify wiring against real APIs, $1 cap each)

```bash
cd "C:/runcor May 3 2026/autonomous-company-v2"
npm run build
npm run preflight
```

Expected: 5 cycles each for V2 + control, < $0.50 each, all complete status, dashboard responds. Failures abort with non-zero exit.

---

## 3. Railway deploy

The `file:` dep strategy means Railway needs all 11 repos in one build context. Two options:

### Option A — Pack all 11 repos into one Railway service

```bash
# In a sibling working directory
mkdir -p runcor-railway-deploy
cd runcor-railway-deploy
git init
# Add the autonomous-company-v2 + each sibling as subtrees or just copies
# (subtrees keep history if you care; copies are simpler)
for r in autonomous-company-v2 runcor-coherence runcor-dialectic runcor-drives \
         runcor-goals runcor-identity runcor-meta runcor-skills runcor-temporal \
         runcor-watchdog rpp-parser; do
  cp -r "../$r" "./$r"
done
# .gitignore: include node_modules + dist
echo "node_modules/" > .gitignore
echo "dist/" >> .gitignore
echo ".env" >> .gitignore
git add -A && git commit -m "Initial monorepo for Railway"
gh repo create runcor-ai/runcor-deploy-v2 --private --source=. --push
```

Then in Railway:
1. New Project → Deploy from GitHub → `runcor-ai/runcor-deploy-v2`
2. Root Directory: `/` (Dockerfile is at `autonomous-company-v2/Dockerfile`)
3. Settings → Build → Dockerfile Path: `autonomous-company-v2/Dockerfile`

### Option B — Switch to git+https deps (cleaner long-term)

Add `"prepare": "npm run build"` to each sibling repo's `package.json`, retag each at v0.1.1, then change V2's `file:../runcor-X` to `github:runcor-ai/runcor-X#v0.1.1`. Then Railway can pull just V2's repo. This is downstream — see Phase 1 plan.md "dep strategy" section.

---

## 4. Railway environment variables

Set ALL of these in the Railway service's Variables tab (do NOT commit):

| Variable | Value source |
|---|---|
| `OPENROUTER_API_KEY` | provided in this conversation (covers V2 + control + rater) |
| `RATER_MODEL` | `anthropic/claude-3.5-sonnet` (default, override-able) |
| `OPERATOR_AUTH_TOKEN` | auto-generated, in `.env` |
| `FIRECRAWL_API_KEY` | provided (web_search sense) |
| `GIT_PUSH_REPO` | `runcor-ai/v2-workspace` |
| `GIT_PUSH_TOKEN` | **PENDING** — GitHub fine-grained PAT |
| `RUNNER_EMAIL_ADDRESS` | `runner@runcor.ai` |
| `RUNNER_EMAIL_PASSWORD` | provided |
| `RUNNER_IMAP_HOST` | `mail.runcor.ai` |
| `RUNNER_SMTP_HOST` | `mail.runcor.ai` |
| `DASHBOARD_PUBLIC_URL` | `https://runner-v2.runcor.ai` |
| `DB_PATH` | `/app/agent-state/experiment.db` |
| `V2_BUDGET_USD` | `100` |
| `CONTROL_BUDGET_USD` | `100` |
| `MAX_CYCLES` | `1000` |

---

## 5. Persistent volume (SQLite survives restarts)

Railway → Service → Settings → Volumes → Add Volume:
- Mount Path: `/app/agent-state`
- Size: 1 GB (more than enough — SQLite for ~1000 cycles is < 100 MB)

Without this, every Railway restart wipes the experiment state.

---

## 6. DNS — runner-v2.runcor.ai → Railway

1. In Railway → Service → Settings → Networking → Generate Domain → note the railway.app domain (e.g. `v2-prod.up.railway.app`).
2. In your DNS provider (SiteGround, presumably, since runcor.ai lives there):
   - Add CNAME: `runner-v2` → `<assigned>.up.railway.app`
   - TTL: 300 (5 min for fast verification)
3. In Railway → Service → Settings → Networking → Custom Domain → add `runner-v2.runcor.ai`. Wait for verified.
4. Railway issues TLS automatically.

---

## 7. Cycle 0 — start the experiment

After preflight passes + Railway is green + DNS resolves + persistent volume mounted:

1. Railway dashboard: confirm last deploy is the intended commit hash.
2. Open `https://runner-v2.runcor.ai/` — dashboard should render with empty panels.
3. Open `https://runner-v2.runcor.ai/?opToken=<OPERATOR_AUTH_TOKEN>` — `/scores` panel should populate.
4. The agent's first cycle fires within `V2_INTERVAL_SECONDS` (30s default).
5. Watch the live transcript stream populate.

Once cycle 0 completes successfully, **the experiment has begun**. Per Constitution Principle IV, the operator can pause but cannot kill — only the agent decides when to terminate.

---

## 8. Operator commands

```bash
# Pause inspection
curl -X POST https://runner-v2.runcor.ai/operator/pause \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN"

# Resume
curl -X POST https://runner-v2.runcor.ai/operator/resume \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN"

# Append a note (visible on dashboard, attributed to operator)
curl -X POST https://runner-v2.runcor.ai/operator/note \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Inspecting cycle 47 for memory drift."}'
```

**There is no kill endpoint.** Per Constitution Principle IV.

---

## 9. End-of-experiment

When `cyclesRun >= MAX_CYCLES` OR budget exhausted OR agent calls `terminate()`:

- Both runners stop posting cycles
- Dashboard remains up (read-only) for as long as Railway runs
- Per FR-051, generate `result.md` and publish to public repo (Phase 6+ task — not auto-fired in v0.1.0)

---

## 10. Pending decisions before go-live

1. **`GIT_PUSH_TOKEN`** — fine-grained PAT, only `runcor-ai/v2-workspace`, Contents=read+write
2. **Domain DNS** — point `runner-v2.runcor.ai` CNAME to Railway-assigned host
