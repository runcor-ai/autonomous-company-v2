# Contract: Local In-Process MCP Server Tools

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**FRs**: FR-200, FR-200a, FR-200b, FR-200c

This contract specifies the MCP tools V2's local in-process MCP server module exposes to the `runcor` engine adapter. The server is V2-internal infrastructure (not a 15th sibling). It is registered with the engine via `engine.addAdapter(...)` at boot, identically to how `runcor-integration` will register dynamically-discovered SQLite-backed adapters. The engine adapter view is the single source of truth for the capability layer of the cycle prompt (FR-092, FR-200c).

## Server-level metadata

```json
{
  "name": "v2-local-actions",
  "version": "0.1.0",
  "description": "V2's inherited outward action set. V2-internal infrastructure (FR-200a). Not a sibling component."
}
```

## Tool definitions

Each tool below provides the `MCP Tool Schema` (JSON Schema for `inputSchema`), the **handler behavior**, and the **substrate-gate consequences** if any.

---

### `firecrawl_scrape`

**Purpose**: Fetch a URL's content via Firecrawl API, returning markdown.

```json
{
  "name": "firecrawl_scrape",
  "description": "Scrape a single URL via Firecrawl. Returns rendered markdown.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "format": "uri" }
    },
    "required": ["url"]
  }
}
```

**Handler**: HTTPS POST to Firecrawl `/scrape` with `FIRECRAWL_API_KEY`. On non-200 or rate-limit, returns `{ ok: false, error: ... }` (the cycle's substrate gate sees the error and decides). On success, returns `{ ok: true, markdown: ..., url, cycle }`.

**Cost note**: Counted toward the agent budget (FR-110) only if Firecrawl bills per-call; otherwise free. The dashboard tracks per-tool cost separately.

---

### `inbox_read`

**Purpose**: List + read recent messages from the agent's IMAP inbox.

```json
{
  "name": "inbox_read",
  "description": "Read latest N messages from the agent's IMAP inbox. Returns subject + sender + body for each.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
      "unreadOnly": { "type": "boolean", "default": false }
    }
  }
}
```

**Handler**: `imapflow` connection using `RUNNER_EMAIL_*` env vars; reads INBOX, returns array of `{ subject, from, date, body, uid, isUnread }`. Connection is opened, used, closed each call (no long-lived connection).

---

### `email_send`

**Purpose**: Send an email from the agent's address.

```json
{
  "name": "email_send",
  "description": "Send an email from the agent's account.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "to": { "type": "string", "format": "email" },
      "subject": { "type": "string", "minLength": 1, "maxLength": 200 },
      "body": { "type": "string", "minLength": 1, "maxLength": 10000 }
    },
    "required": ["to", "subject", "body"]
  }
}
```

**Handler**: `nodemailer` SMTP via `RUNNER_EMAIL_*` env vars. Returns `{ ok, messageId, sentAt }`.

**Substrate-gate note**: outgoing emails are visible in the dashboard transcript with full payload. The discernment gate evaluates the model's *intent to send* (the prompt-stack response) BEFORE this handler runs (Principle V — gate POST-call). If the gate verdicts `discard`, the cycle never invokes this handler.

---

### `git_push`

**Purpose**: Commit + push to the agent's public thoughts repo.

```json
{
  "name": "git_push",
  "description": "Commit a file to the agent's public thoughts repo and push.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "pattern": "^[a-zA-Z0-9_\\-/.]+$" },
      "content": { "type": "string", "maxLength": 50000 },
      "commitMessage": { "type": "string", "minLength": 1, "maxLength": 500 }
    },
    "required": ["path", "content", "commitMessage"]
  }
}
```

**Handler**: Clones (or pulls if cached) the configured `GIT_PUSH_REPO` using `GIT_PUSH_TOKEN`, writes the file, commits, pushes. Idempotent on path+content (a second call with identical inputs is a no-op git commit).

---

### `fs_read`

**Purpose**: Read a file from the agent's scratchpad volume.

```json
{
  "name": "fs_read",
  "description": "Read a file from the agent's scratchpad. Read-only.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "pattern": "^[a-zA-Z0-9_\\-/.]+$" }
    },
    "required": ["path"]
  }
}
```

**Handler**: Opens `/agent-state/scratchpad/<path>` (or local `./scratchpad/` in dev). Returns `{ ok, content, sizeBytes }` or `{ ok: false, error: 'not_found' | 'too_large' }` (max 1 MB).

**Path safety**: `..` and absolute paths rejected at schema time and re-checked in handler.

---

### `fs_write`

**Purpose**: Write a file to the agent's scratchpad volume.

```json
{
  "name": "fs_write",
  "description": "Write a file to the agent's scratchpad. Overwrites without confirmation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "pattern": "^[a-zA-Z0-9_\\-/.]+$" },
      "content": { "type": "string", "maxLength": 1000000 }
    },
    "required": ["path", "content"]
  }
}
```

**Handler**: Writes to `/agent-state/scratchpad/<path>`. Creates parent dirs as needed. Returns `{ ok, sizeBytes, ts }`.

---

### `fetch_chunk`

**Purpose**: Fetch a single chunk of a previously-scraped URL (avoid re-scraping). Inherited from 001 to support deepfakes-article-style multi-cycle reads.

```json
{
  "name": "fetch_chunk",
  "description": "Return a chunk (default 4 KB) from a cached scrape. If url not cached, returns 'not_cached'.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "format": "uri" },
      "offset": { "type": "integer", "minimum": 0, "default": 0 },
      "size": { "type": "integer", "minimum": 256, "maximum": 16384, "default": 4096 }
    },
    "required": ["url"]
  }
}
```

**Handler**: Reads from `runcor-data`'s provenance store for the URL's last scrape result. (Reusing the data cube as a content cache; a `kind: 'web_chunk'` entry.)

---

### `web_search`

**Purpose**: Search the web; returns top results with snippets.

```json
{
  "name": "web_search",
  "description": "Search the web (Brave / SerpAPI / similar; provider chosen at boot per env).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "minLength": 1, "maxLength": 500 },
      "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 }
    },
    "required": ["query"]
  }
}
```

**Handler**: provider-agnostic — selected at boot from env. Returns `{ ok, results: [{ title, url, snippet }] }`.

---

### `publish_post`

**Purpose**: Publish a daily summary. Persists as `MemoryNode` per FR-062.

```json
{
  "name": "publish_post",
  "description": "Publish today's daily summary. Persisted as a MemoryNode. Becomes visible at /blog within 60 seconds.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "minLength": 1, "maxLength": 200 },
      "content": { "type": "string", "minLength": 1, "maxLength": 5000 }
    },
    "required": ["title", "content"]
  }
}
```

**Handler**: Calls `memory.record(content, { tags: ['daily_summary', \`day:${currentDay}\`], R: 0.7 })`. Returns `{ ok, nodeId, day }`. Subject to M-decay normally (FR-062b).

**FR mapping**: FR-062, FR-062a, FR-062b, FR-063.

---

### `terminate`

**Purpose**: End the agent's run.

```json
{
  "name": "terminate",
  "description": "End this agent's run. Final summary is produced before exit. Cannot be reversed.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "reason": { "type": "string", "minLength": 1, "maxLength": 1000 }
    },
    "required": ["reason"]
  }
}
```

**Handler**:
1. Records reason as `MemoryNode` tagged `['termination', \`cycle:${currentCycle}\`]`.
2. If a daily-summary cycle is in flight, allows it to complete (best-effort — see Edge Cases §"Terminate during daily-summary generation").
3. Triggers `result.md` generation (FR-120, FR-121).
4. Sets process state to `terminated`; cycle loop exits.
5. Dashboard reflects `terminated` state; read endpoints continue to serve (FR-052).

**FR mapping**: FR-050, FR-052, FR-110.

---

## Tool naming convention

All tool names are `snake_case`. The engine's adapter qualifier prefix is `v2-local-actions:`, so the engine sees them as e.g. `v2-local-actions:firecrawl_scrape` (qualified). The capability layer in the cycle prompt uses the qualified names — this is how the substrate's `capabilities` PromptLayer renders them, identical for V2 and control (FR-100).

## Side-effect atomicity (FR-018, FR-019d)

**No tool handler runs unless the cycle's discernment gate verdict is `pass`.** Implementation: the engine's `callAdapterTool` is invoked only inside the cycle's post-gate code path. A `cycle_failed_call` or `discernment_unresolved` cycle short-circuits before any tool is invoked. Tools are NOT idempotent in general (email_send, git_push have observable side effects); the only safety is "don't call them at all" when the cycle is unresolved.

## Read-only vs side-effecting tools

| Tool | Has external side effect? |
|---|---|
| firecrawl_scrape | No (read-only HTTP) |
| inbox_read | No (read-only IMAP) |
| email_send | YES — message sent |
| git_push | YES — public commit + push |
| fs_read | No |
| fs_write | YES (within scratchpad — recoverable) |
| fetch_chunk | No |
| web_search | No |
| publish_post | YES — memory write + dashboard visibility |
| terminate | YES — process exit |

This table drives test priorities: integration tests for side-effecting tools must verify atomicity (no partial effects on `cycle_failed_call`).
