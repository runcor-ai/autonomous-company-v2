// github_create_repo — create a new GitHub repository under the agent's account/org.
//
// Uses GIT_PUSH_TOKEN (the same PAT the agent's git_push uses to push commits). The token
// must have the `repo` scope. Newly-created repos are public by default — the agent is
// running publicly and creating private repos would obscure its activity from observers
// (Principle III). The agent can pass `private: true` if it explicitly chooses to.
//
// After creating a repo, the agent can push files to it via git_push by passing the new
// repo's full path (owner/name) as the `repo` argument.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface GitHubRepoResponse {
  id?: number;
  name?: string;
  full_name?: string;
  html_url?: string;
  clone_url?: string;
  ssh_url?: string;
  private?: boolean;
  description?: string | null;
  message?: string;
  errors?: Array<{ resource?: string; code?: string; message?: string }>;
}

export const githubCreateRepo: LocalToolFactory = (deps) => ({
  name: 'github_create_repo',
  description:
    'Create a new GitHub repository under your account. Returns the full repo path (owner/name) and clone URL. Use git_push with the repo argument to commit files to the new repo afterward. Repos are public by default — pass private:true only if you have a specific reason to hide activity from observers.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_.-]+$' },
      description: { type: 'string', maxLength: 350 },
      private: { type: 'boolean', default: false },
      org: {
        type: 'string',
        description: 'Optional org name. If absent, repo is created under the token\'s owning user.',
      },
    },
    required: ['name'],
  },
  handler: async (args) => {
    const token = deps.env.gitPushToken;
    if (!token) {
      return errResult('github_unconfigured', { hint: 'GIT_PUSH_TOKEN not set' });
    }

    const name = typeof args.name === 'string' ? args.name : '';
    const description = typeof args.description === 'string' ? args.description : '';
    const isPrivate = args.private === true;
    const org = typeof args.org === 'string' && args.org.length > 0 ? args.org : null;

    if (!name) return errResult('name required');

    const url = org
      ? `https://api.github.com/orgs/${encodeURIComponent(org)}/repos`
      : 'https://api.github.com/user/repos';

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'runcor-v2',
        },
        body: JSON.stringify({
          name,
          description,
          private: isPrivate,
          auto_init: true,
        }),
      });

      const data = (await res.json()) as GitHubRepoResponse;

      if (!res.ok) {
        const detail = data.errors?.map((e) => `${e.resource ?? '?'}.${e.code ?? '?'}: ${e.message ?? ''}`).join('; ') ?? '';
        return errResult(
          `github_${res.status}: ${data.message ?? res.statusText}${detail ? ' — ' + detail : ''}`,
          { hint: 'Token may lack the repo scope, or the repo name already exists.' },
        );
      }

      return okResult({
        created: true,
        repo: data.full_name,
        url: data.html_url,
        cloneUrl: data.clone_url,
        private: data.private,
      });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'github_create_repo_failure');
    }
  },
});
