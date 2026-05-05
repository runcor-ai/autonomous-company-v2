// Sense: inbox_read — read recent unread messages via IMAP.
// Uses dynamic import of 'imapflow' to keep the dependency optional at the type-check level.

export interface InboxReadInput {
  /** Mailbox name. Default 'INBOX'. */
  mailbox?: string;
  /** Max messages to return. */
  limit?: number;
  /** Only unread? Default true. */
  unreadOnly?: boolean;
}

export interface InboxMessage {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
  preview: string;
  unread: boolean;
}

export interface InboxConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
}

export interface InboxReader {
  read(input?: InboxReadInput): Promise<InboxMessage[]>;
}

/**
 * Construct an IMAP-backed reader. Real implementation uses imapflow at runtime.
 * For tests, pass a mock implementation via createMockInboxReader.
 */
export function createInboxReader(config: InboxConfig): InboxReader {
  return {
    async read(input = {}) {
      // Lazy import — keeps imapflow optional + avoids loading at module init.
      const { ImapFlow } = await import('imapflow') as typeof import('imapflow');
      const client = new ImapFlow({
        host: config.host, port: config.port,
        secure: config.secure ?? true,
        auth: { user: config.user, pass: config.pass },
        logger: false,
      });
      try {
        await client.connect();
        const lock = await client.getMailboxLock(input.mailbox ?? 'INBOX');
        try {
          const search = input.unreadOnly === false ? { all: true } : { seen: false };
          const uids = await client.search(search) as number[];
          const recent = uids.slice(-1 * (input.limit ?? 10));
          const out: InboxMessage[] = [];
          for await (const m of client.fetch(recent, { envelope: true, source: true, flags: true } as never)) {
            const env = m.envelope ?? {};
            const src = m.source?.toString() ?? '';
            out.push({
              uid: m.uid as number,
              from: ((env as { from?: Array<{ address?: string }> }).from?.[0]?.address) ?? '',
              to: ((env as { to?: Array<{ address?: string }> }).to?.[0]?.address) ?? '',
              subject: (env as { subject?: string }).subject ?? '',
              date: ((env as { date?: Date }).date)?.toISOString?.() ?? '',
              preview: src.slice(0, 500),
              unread: !(m.flags?.has('\\Seen')),
            });
          }
          return out;
        } finally { lock.release(); }
      } finally { await client.logout(); }
    },
  };
}

/** For tests. */
export function createMockInboxReader(messages: InboxMessage[]): InboxReader {
  return { async read() { return messages; } };
}
