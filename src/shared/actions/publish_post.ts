// Action: publish_post — write a post to the dashboard's internal blog (SQLite-backed).

import type { Store } from '../db.js';
import type { AgentKind, SummaryRecord } from '../types.js';

export interface PublishPostInput {
  kind: AgentKind;
  dayNumber: number;
  text: string;
}

export interface PublishPostResult {
  postId: number;
  publicUrl: string;
}

export interface PublishPostConfig {
  store: Store;
  /** Public URL prefix where the dashboard renders the blog. */
  publicUrlPrefix: string;
}

export interface PostPublisher {
  publish(input: PublishPostInput): Promise<PublishPostResult>;
}

export function createPostPublisher(config: PublishPostConfig): PostPublisher {
  return {
    async publish(input) {
      const summary: SummaryRecord = config.store.addSummary(input.kind, input.dayNumber, input.text);
      const slug = input.kind === 'control' ? 'control' : 'agent';
      return {
        postId: summary.id,
        publicUrl: `${config.publicUrlPrefix.replace(/\/$/, '')}/blog/${slug}/day-${input.dayNumber}`,
      };
    },
  };
}
