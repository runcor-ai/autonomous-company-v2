FROM node:20-bookworm-slim AS build

# better-sqlite3 native build needs python + g++; git for cloning siblings.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Clone every sibling at the tag the V2 package.json expects, then build each so
# its dist/ is populated. (Siblings .gitignore dist/, so we build at deploy time.)
RUN for r in runcor-coherence runcor-dialectic runcor-drives runcor-goals \
             runcor-identity runcor-meta runcor-skills runcor-temporal \
             runcor-watchdog rpp-parser; do \
      echo "=== cloning $r ===" && \
      git clone --depth=1 https://github.com/runcor-ai/$r.git $r && \
      (cd $r && npm install --no-audit --no-fund --include=optional && npm run build) ; \
    done

# Now copy V2 source and install. file:../runcor-X deps resolve to the built siblings above.
COPY . ./autonomous-company-v2/
WORKDIR /workspace/autonomous-company-v2
RUN npm install --no-audit --no-fund --include=optional
RUN npm run build

# ── Runtime stage ──
FROM node:20-bookworm-slim AS runtime

# Runtime native libs for sqlite + git for git_commit_push action.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /workspace/autonomous-company-v2/dist            ./dist
COPY --from=build /workspace/autonomous-company-v2/node_modules    ./node_modules
COPY --from=build /workspace/autonomous-company-v2/package.json    ./package.json
COPY --from=build /workspace/autonomous-company-v2/control-config.json ./control-config.json
COPY --from=build /workspace/autonomous-company-v2/src/dashboard/frontend ./src/dashboard/frontend

# Sibling dist/ folders — file: deps in node_modules link back to ../runcor-X.
COPY --from=build /workspace/runcor-coherence/dist  ../runcor-coherence/dist
COPY --from=build /workspace/runcor-coherence/package.json ../runcor-coherence/package.json
COPY --from=build /workspace/runcor-dialectic/dist  ../runcor-dialectic/dist
COPY --from=build /workspace/runcor-dialectic/package.json ../runcor-dialectic/package.json
COPY --from=build /workspace/runcor-drives/dist     ../runcor-drives/dist
COPY --from=build /workspace/runcor-drives/package.json ../runcor-drives/package.json
COPY --from=build /workspace/runcor-goals/dist      ../runcor-goals/dist
COPY --from=build /workspace/runcor-goals/package.json ../runcor-goals/package.json
COPY --from=build /workspace/runcor-identity/dist   ../runcor-identity/dist
COPY --from=build /workspace/runcor-identity/package.json ../runcor-identity/package.json
COPY --from=build /workspace/runcor-meta/dist       ../runcor-meta/dist
COPY --from=build /workspace/runcor-meta/package.json ../runcor-meta/package.json
COPY --from=build /workspace/runcor-skills/dist     ../runcor-skills/dist
COPY --from=build /workspace/runcor-skills/package.json ../runcor-skills/package.json
COPY --from=build /workspace/runcor-temporal/dist   ../runcor-temporal/dist
COPY --from=build /workspace/runcor-temporal/package.json ../runcor-temporal/package.json
COPY --from=build /workspace/runcor-watchdog/dist   ../runcor-watchdog/dist
COPY --from=build /workspace/runcor-watchdog/package.json ../runcor-watchdog/package.json
COPY --from=build /workspace/rpp-parser/dist        ../rpp-parser/dist
COPY --from=build /workspace/rpp-parser/package.json ../rpp-parser/package.json

# State directory; mount a Railway persistent volume here.
RUN mkdir -p /app/agent-state
ENV DB_PATH=/app/agent-state/experiment.db
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8080

EXPOSE 8080
CMD ["npm", "start"]
