// inbox_read (T062) — read recent IMAP messages via imapflow.
//
// Per contracts/mcp-local-tools.md. Connection is opened/used/closed per call (no long-lived
// connection); cost is the connection latency, paid once per cycle that uses inbox.

import { ImapFlow } from 'imapflow';
import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface ImapMessage {
  subject?: string;
  from?: { value?: Array<{ address?: string; name?: string }> };
  date?: Date;
  uid?: number;
  flags?: Set<string>;
}

export const inboxRead: LocalToolFactory = (deps) => ({
  name: 'inbox_read',
  description: "Read latest N messages from the agent's inbox. Returns subject + sender + body for each.",
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      unreadOnly: { type: 'boolean', default: false },
    },
  },
  handler: async (args) => {
    const cfg = deps.env.runnerEmail;
    if (!cfg) {
      return errResult('email_unconfigured', { hint: 'RUNNER_EMAIL_USER/PASS/IMAP_HOST/SMTP_HOST not set' });
    }

    const limit = typeof args.limit === 'number' ? Math.min(50, Math.max(1, args.limit)) : 10;
    const unreadOnly = args.unreadOnly === true;

    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapPort === 993,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const search = unreadOnly ? { seen: false } : { all: true };
        const messages: Array<{
          subject: string;
          from: string;
          date: string;
          uid: number;
          isUnread: boolean;
          body: string;
        }> = [];

        for await (const msg of client.fetch(search, { envelope: true, source: true, uid: true, flags: true }) as AsyncIterable<ImapMessage & { source?: Buffer; envelope?: { subject?: string; from?: Array<{ address?: string; name?: string }> }; uid: number }>) {
          if (messages.length >= limit) break;
          const env = msg.envelope ?? {};
          const fromEntry = env.from?.[0];
          messages.push({
            subject: env.subject ?? '',
            from: fromEntry ? `${fromEntry.name ?? ''} <${fromEntry.address ?? ''}>`.trim() : '',
            date: msg.date ? msg.date.toISOString() : '',
            uid: msg.uid,
            isUnread: !msg.flags?.has('\\Seen'),
            body: msg.source ? msg.source.toString('utf8').slice(0, 10_000) : '',
          });
        }

        return okResult({ count: messages.length, messages });
      } finally {
        lock.release();
      }
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'imap_failure');
    } finally {
      try {
        await client.logout();
      } catch {
        // ignore
      }
    }
  },
});
