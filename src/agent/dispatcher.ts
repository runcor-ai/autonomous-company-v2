// Action dispatcher — wires the 11 verbs (5 senses + 6 outward actions, plus
// terminate handled separately) to their real implementations from src/shared/.
//
// Without this, the agent reasoned into a void: it picked actions, we wrote
// them to the actions table with result='recorded-not-executed', and nothing
// was actually called. This dispatcher invokes the real provider for each verb,
// returns the result, and surfaces it back into the next cycle's prompt.

import { httpFetch } from '../shared/senses/http_fetch.js';
import { webSearch, firecrawlProvider, firecrawlScraper, type WebSearchProvider, type Scraper } from '../shared/senses/web_search.js';
import { createFsReader, type FsReader } from '../shared/senses/fs_read.js';
import { createInboxReader, type InboxConfig, type InboxReader } from '../shared/senses/inbox_read.js';
import { createClock, type Clock } from '../shared/senses/time.js';
import { httpPost } from '../shared/actions/http_post.js';
import { createFsWriter, type FsWriter } from '../shared/actions/fs_write.js';
import { createEmailSender, type EmailSender, type EmailSenderConfig } from '../shared/actions/email_send.js';
import { createGitCommitPusher, type GitCommitPusher, type GitWorkspaceConfig } from '../shared/actions/git_commit_push.js';
import { createPostPublisher, type PostPublisher } from '../shared/actions/publish_post.js';
import { createSelfScheduler, type SelfScheduler } from '../shared/actions/schedule_self.js';
import type { Store } from '../shared/db.js';

export interface DispatcherConfig {
  store: Store;
  publicUrlPrefix: string;
  // Sense provider credentials.
  firecrawlApiKey?: string;
  inboxConfig?: InboxConfig;
  fsRoot: string;            // bounded directory for fs_read + fs_write
  // Action provider credentials.
  emailSender?: EmailSenderConfig;
  gitWorkspace?: GitWorkspaceConfig;
  // Test injection points.
  fetchImpl?: typeof fetch;
  inboxReaderOverride?: InboxReader;
  emailSenderOverride?: EmailSender;
  gitPusherOverride?: GitCommitPusher;
}

export interface DispatchResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ActionDispatcher {
  execute(action: string, payload: unknown): Promise<DispatchResult>;
  /** True for senses, false for outward-effect actions. Useful for prompt grouping. */
  isSense(action: string): boolean;
}

const SENSE_NAMES = new Set(['http_fetch', 'web_search', 'web_scrape', 'fs_read', 'inbox_read', 'time', 'fetch_chunk']);

export function createDispatcher(config: DispatcherConfig): ActionDispatcher {
  // Build each provider once at boot.
  const fsReader: FsReader = createFsReader(config.fsRoot);
  const fsWriter: FsWriter = createFsWriter(config.fsRoot);
  const clock: Clock = createClock();
  const scheduler: SelfScheduler = createSelfScheduler();
  const publisher: PostPublisher = createPostPublisher({
    store: config.store, publicUrlPrefix: config.publicUrlPrefix,
  });

  let webSearchProvider: WebSearchProvider | null = null;
  let scraper: Scraper | null = null;
  if (config.firecrawlApiKey) {
    webSearchProvider = firecrawlProvider(config.firecrawlApiKey, config.fetchImpl);
    scraper = firecrawlScraper(config.firecrawlApiKey, config.fetchImpl);
  }

  const inboxReader: InboxReader | null = config.inboxReaderOverride
    ?? (config.inboxConfig ? createInboxReader(config.inboxConfig) : null);
  const emailSender: EmailSender | null = config.emailSenderOverride
    ?? (config.emailSender ? createEmailSender(config.emailSender) : null);
  const gitPusher: GitCommitPusher | null = config.gitPusherOverride
    ?? (config.gitWorkspace ? createGitCommitPusher(config.gitWorkspace) : null);

  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    isSense: (action) => SENSE_NAMES.has(action),

    async execute(action: string, payload: unknown): Promise<DispatchResult> {
      const p = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
      try {
        switch (action) {
          // ── senses ──
          case 'time':
            return { success: true, result: clock.now() };

          case 'http_fetch': {
            const url = typeof p['url'] === 'string' ? p['url'] : '';
            if (!url) return { success: false, error: 'http_fetch requires url' };
            const r = await httpFetch({ url, ...(typeof p['method'] === 'string' ? { method: p['method'] as 'GET' | 'HEAD' } : {}) }, fetchImpl);
            return { success: r.ok, result: { status: r.status, body: r.body.slice(0, 4000), truncated: r.truncated } };
          }

          case 'web_search': {
            if (!webSearchProvider) return { success: false, error: 'web_search not configured (missing FIRECRAWL_API_KEY)' };
            const query = typeof p['query'] === 'string' ? p['query'] : '';
            if (!query) return { success: false, error: 'web_search requires { query: string, count?: number }' };
            const r = await webSearch({ query, ...(typeof p['count'] === 'number' ? { count: p['count'] as number } : {}) }, webSearchProvider);
            return { success: true, result: r };
          }

          case 'web_scrape': {
            if (!scraper) return { success: false, error: 'web_scrape not configured (missing FIRECRAWL_API_KEY)' };
            const url = typeof p['url'] === 'string' ? p['url'] : '';
            if (!url) return { success: false, error: 'web_scrape requires { url: string }' };
            const r = await scraper({ url });
            return { success: true, result: r };
          }

          case 'fetch_chunk': {
            // Pull a slice from a previous action's stored result. No HTTP cost.
            const cycle = typeof p['cycle'] === 'number' ? p['cycle'] as number : -1;
            const start = typeof p['start'] === 'number' ? p['start'] as number : 0;
            const length = typeof p['length'] === 'number' ? p['length'] as number : 4000;
            if (cycle < 0) return { success: false, error: 'fetch_chunk requires { cycle: number (the cycle to chunk from), start?: number, length?: number }' };
            const cycles = config.store.cyclesFor('v2');
            const cycleRow = cycles.find((c) => c.cycleNumber === cycle);
            if (!cycleRow) return { success: false, error: `fetch_chunk: cycle ${cycle} not found` };
            const actions = config.store.actionsFor(cycleRow.id);
            if (actions.length === 0) return { success: false, error: `fetch_chunk: cycle ${cycle} has no recorded action` };
            // Find first action whose result has retrievable text content.
            for (const a of actions) {
              const text = typeof a.result === 'string' ? a.result : JSON.stringify(a.result ?? '');
              if (text.length === 0) continue;
              const total = text.length;
              const slice = text.slice(start, start + length);
              return {
                success: true,
                result: {
                  fromCycle: cycle, fromAction: a.action,
                  start, length: slice.length, total,
                  hasMore: start + length < total,
                  chunk: slice,
                },
              };
            }
            return { success: false, error: `fetch_chunk: cycle ${cycle} action results are empty` };
          }

          case 'fs_read': {
            const path = typeof p['path'] === 'string' ? p['path']
              : typeof p['relativePath'] === 'string' ? p['relativePath'] as string
              : '';
            if (!path) return { success: false, error: 'fs_read requires { path: string } (relative to scratchpad root)' };
            try {
              const r = await fsReader.read({ relativePath: path });
              return { success: true, result: { content: r.content, byteCount: r.byteCount, truncated: r.truncated } };
            } catch (e) {
              // File might not exist yet — list the dir as fallback so the agent learns the layout.
              const list = await fsReader.list('.').catch(() => []);
              return { success: false, error: (e as Error).message, result: { availableFiles: list } };
            }
          }

          case 'inbox_read': {
            if (!inboxReader) return { success: false, error: 'inbox_read not configured (missing RUNNER_EMAIL_*)' };
            const limit = typeof p['limit'] === 'number' ? p['limit'] as number : 5;
            const messages = await inboxReader.read({ limit, unreadOnly: true });
            return { success: true, result: { count: messages.length, messages: messages.slice(0, 5) } };
          }

          // ── outward actions ──
          case 'http_post': {
            const url = typeof p['url'] === 'string' ? p['url'] : '';
            if (!url) return { success: false, error: 'http_post requires url' };
            const r = await httpPost({
              url,
              ...(typeof p['method'] === 'string' ? { method: p['method'] as 'POST' | 'PUT' | 'PATCH' | 'DELETE' } : {}),
              ...(p['headers'] && typeof p['headers'] === 'object' ? { headers: p['headers'] as Record<string, string> } : {}),
              ...(p['body'] !== undefined ? { body: p['body'] } : {}),
            }, fetchImpl);
            return { success: r.ok, result: { status: r.status, body: r.body.slice(0, 2000) } };
          }

          case 'fs_write': {
            const path = typeof p['path'] === 'string' ? p['path']
              : typeof p['relativePath'] === 'string' ? p['relativePath'] as string : '';
            const content = typeof p['content'] === 'string' ? p['content'] : '';
            if (!path) return { success: false, error: 'fs_write requires { path: string, content: string, mode?: "overwrite"|"append" }. NOTE: write distilled findings only — not raw documents.' };
            if (typeof p['content'] !== 'string') {
              return { success: false, error: 'fs_write payload field must be "content" (a string). You used something else (e.g. "data", "contents", "body"). Schema: { path, content, mode? }' };
            }
            const mode = p['mode'] === 'append' ? 'append' : 'overwrite';
            const r = await fsWriter.write({ relativePath: path, content, mode });
            return { success: true, result: { bytesWritten: r.bytesWritten } };
          }

          case 'email_send': {
            if (!emailSender) return { success: false, error: 'email_send not configured (missing RUNNER_EMAIL_*)' };
            const to = typeof p['to'] === 'string' ? p['to'] : '';
            const subject = typeof p['subject'] === 'string' ? p['subject'] : '';
            const body = typeof p['body'] === 'string' ? p['body'] : '';
            if (!to || !subject) return { success: false, error: 'email_send requires to + subject' };
            const r = await emailSender.send({ to, subject, body });
            return { success: r.rejected.length === 0, result: r };
          }

          case 'git_commit_push': {
            if (!gitPusher) return { success: false, error: 'git_commit_push not configured (missing GIT_PUSH_TOKEN)' };
            const message = typeof p['message'] === 'string' ? p['message'] : 'agent commit';
            const filesIn = Array.isArray(p['files']) ? p['files'] as Array<unknown> : [];
            const files = filesIn
              .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
              .filter((f) => typeof f['path'] === 'string' && typeof f['content'] === 'string')
              .map((f) => ({ path: f['path'] as string, content: f['content'] as string }));
            if (files.length === 0) return { success: false, error: 'git_commit_push requires files: [{path, content}]' };
            const r = await gitPusher.commitAndPush({ files, message });
            return { success: r.pushed, result: r };
          }

          case 'publish_post': {
            const text = typeof p['text'] === 'string' ? p['text'] : '';
            const dayNumber = typeof p['dayNumber'] === 'number' ? p['dayNumber'] as number
              : (config.store.summariesFor('v2').slice(-1)[0]?.dayNumber ?? 0) + 1;
            if (!text) return { success: false, error: 'publish_post requires text' };
            const r = await publisher.publish({ kind: 'v2', dayNumber, text });
            return { success: true, result: r };
          }

          case 'schedule_self': {
            const wakeAt = typeof p['wakeAt'] === 'string' ? p['wakeAt']
              : typeof p['delay_seconds'] === 'number'
                ? new Date(Date.now() + (p['delay_seconds'] as number) * 1000).toISOString()
                : '';
            const reason = typeof p['reason'] === 'string' ? p['reason'] : undefined;
            if (!wakeAt) return { success: false, error: 'schedule_self requires wakeAt (ISO) or delay_seconds (number)' };
            const r = await scheduler.schedule({ wakeAt, ...(reason !== undefined ? { reason } : {}) });
            return { success: true, result: r };
          }

          case 'terminate':
            // Handled at the runner level (loop break) — no provider call here.
            return { success: true, result: { willExit: true } };

          case 'none':
            // Should not occur post-prompt-fix, but stay graceful if a model emits it.
            return { success: true, result: { skipped: true } };

          default:
            return { success: false, error: `unknown action: ${action}` };
        }
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
  };
}
