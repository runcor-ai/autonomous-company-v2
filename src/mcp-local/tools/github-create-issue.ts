// github_create_issue — open an issue on a GitHub repository.
//
// Lightweight engagement primitive: lets the agent ask a question, post a finding, or
// surface a problem on any repo it has write access to (under GIT_PUSH_TOKEN's scope).
// Returns the issue's URL so the agent can reference it in subsequent actions (blog
// posts, emails, follow-up commits).

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface GitHubIssueResponse {
  number?: number;
  html_url?: string;
  title?: string;
  state?: string;
  message?: string;
  errors?: Array<{ message?: string }>;
}

export const githubCreateIssue: LocalToolFactory = (deps) => ({
  name: 'github_create_issue',
  description:
    'Open an issue on a GitHub repository. Useful for posting findings, asking questions, or tracking work. Returns the issue URL.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        pattern: '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$',
        description: 'Full path: owner/name. Token must have write access to the repo.',
      },
      title: { type: 'string', minLength: 1, maxLength: 256 },
      body: { type: 'string', maxLength: 50_000 },
      labels: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
    required: ['repo', 'title'],
  },
  handler: async (args) => {
    const token = deps.env.gitPushToken;
    if (!token) {
      return errResult('github_unconfigured', { hint: 'GIT_PUSH_TOKEN not set' });
    }

    const repo = typeof args.repo === 'string' ? args.repo : '';
    const title = typeof args.title === 'string' ? args.title : '';
    const body = typeof args.body === 'string' ? args.body : '';
    const labels = Array.isArray(args.labels) ? args.labels.filter((x): x is string => typeof x === 'string') : [];

    if (!repo) return errResult('repo required (owner/name)');
    if (!title) return errResult('title required');
    if (!repo.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) return errResult('repo must be owner/name');

    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'runcor-v2',
        },
        body: JSON.stringify({ title, body, ...(labels.length > 0 ? { labels } : {}) }),
      });

      const data = (await res.json()) as GitHubIssueResponse;
      if (!res.ok) {
        const detail = data.errors?.map((e) => e.message ?? '').filter(Boolean).join('; ') ?? '';
        return errResult(`github_${res.status}: ${data.message ?? res.statusText}${detail ? ' — ' + detail : ''}`);
      }

      return okResult({
        opened: true,
        issue: data.number,
        url: data.html_url,
        title: data.title,
      });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'github_create_issue_failure');
    }
  },
});
