FROM node:20-bookworm-slim AS build

# better-sqlite3 native build needs python + g++
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy the V2 repo
COPY autonomous-company-v2/ ./autonomous-company-v2/
# Copy each sibling repo at the same relative path the file: deps expect (../runcor-X)
COPY runcor-coherence/      ./runcor-coherence/
COPY runcor-dialectic/      ./runcor-dialectic/
COPY runcor-drives/         ./runcor-drives/
COPY runcor-goals/          ./runcor-goals/
COPY runcor-identity/       ./runcor-identity/
COPY runcor-meta/           ./runcor-meta/
COPY runcor-skills/         ./runcor-skills/
COPY runcor-temporal/       ./runcor-temporal/
COPY runcor-watchdog/       ./runcor-watchdog/
COPY rpp-parser/            ./rpp-parser/

WORKDIR /workspace/autonomous-company-v2
RUN npm install --include=optional
RUN npm run build

FROM node:20-bookworm-slim AS runtime

# Runtime native libs for sqlite + git for git_commit_push
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts + node_modules + sibling sources
COPY --from=build /workspace/autonomous-company-v2/dist            ./dist
COPY --from=build /workspace/autonomous-company-v2/node_modules    ./node_modules
COPY --from=build /workspace/autonomous-company-v2/package.json    ./package.json
COPY --from=build /workspace/autonomous-company-v2/control-config.json ./control-config.json
# Copy sibling sources (file: deps resolve to ../runcor-X)
COPY --from=build /workspace/runcor-coherence/dist  ../runcor-coherence/dist
COPY --from=build /workspace/runcor-dialectic/dist  ../runcor-dialectic/dist
COPY --from=build /workspace/runcor-drives/dist     ../runcor-drives/dist
COPY --from=build /workspace/runcor-goals/dist      ../runcor-goals/dist
COPY --from=build /workspace/runcor-identity/dist   ../runcor-identity/dist
COPY --from=build /workspace/runcor-meta/dist       ../runcor-meta/dist
COPY --from=build /workspace/runcor-skills/dist     ../runcor-skills/dist
COPY --from=build /workspace/runcor-temporal/dist   ../runcor-temporal/dist
COPY --from=build /workspace/runcor-watchdog/dist   ../runcor-watchdog/dist
COPY --from=build /workspace/rpp-parser/dist        ../rpp-parser/dist

# State directory (SQLite DBs land here; mount a persistent volume in Railway)
RUN mkdir -p /app/agent-state
ENV DB_PATH=/app/agent-state/experiment.db
ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
