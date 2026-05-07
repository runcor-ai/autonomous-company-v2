# Single-stage — siblings keep node_modules in place so file: dep imports
# (better-sqlite3 et al.) resolve from each sibling's directory.
#
# Layout inside the image:
#   /workspace/runcor-X/             cloned + built siblings (with node_modules)
#   /workspace/autonomous-company-v2 V2 source + dist + node_modules
#   /app/agent-state                 Railway-volume mount (persistent SQLite dbs)

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Clone every sibling at runcor-ai, then build each so its dist/ + node_modules
# are populated. (Siblings .gitignore dist/, so we build at deploy time.)
# V2-002 added 5 siblings to the harness: runcor (engine), runcor-substrate,
# runcor-memory, runcor-data, runcor-integration.
RUN for r in runcor runcor-substrate runcor-memory runcor-data runcor-integration \
             runcor-coherence runcor-dialectic runcor-drives runcor-goals \
             runcor-identity runcor-meta runcor-skills runcor-temporal \
             runcor-watchdog rpp-parser; do \
      echo "=== cloning $r ===" && \
      git clone --depth=1 https://github.com/runcor-ai/$r.git $r && \
      (cd $r && npm install --no-audit --no-fund --include=optional && npm run build) ; \
    done

COPY . ./autonomous-company-v2/
WORKDIR /workspace/autonomous-company-v2
RUN npm install --no-audit --no-fund --include=optional

# Explicit copy fallback. npm's file: dep symlinks resolve at build time but appear to
# get stripped during Railway's image push, leaving V2's node_modules without the siblings
# at runtime. Hard-copy each sibling into V2's node_modules so they survive image transit.
# Heavier than symlinks but eliminates the symlink-stripping question.
RUN for r in runcor runcor-substrate runcor-memory runcor-data runcor-integration \
             runcor-coherence runcor-dialectic runcor-drives runcor-goals \
             runcor-identity runcor-meta runcor-skills runcor-temporal \
             runcor-watchdog rpp-parser; do \
      rm -rf /workspace/autonomous-company-v2/node_modules/$r && \
      cp -r /workspace/$r /workspace/autonomous-company-v2/node_modules/$r ; \
    done && \
    ls -d /workspace/autonomous-company-v2/node_modules/runcor* /workspace/autonomous-company-v2/node_modules/rpp-parser

RUN npm run build

# Persistent state (Railway-volume mount lives here).
RUN mkdir -p /app/agent-state
ENV DB_PATH=/app/agent-state/experiment.db
ENV HARNESS_DB_DIR=/app/agent-state
# CRITICAL — agentStateDir defaults to ./agent-state (in the container's working dir,
# which is wiped on every redeploy). Pinning to /app/agent-state puts memory, rater
# scores, dashboard summaries, hypothesis evals, and cycle state on the persistent
# Railway volume. Without this every push silently resets the experiment.
ENV AGENT_STATE_DIR=/app/agent-state
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8080

EXPOSE 8080
CMD ["npm", "start"]
