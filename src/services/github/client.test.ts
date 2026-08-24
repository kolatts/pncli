import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHubClient } from './client.js';
import { HttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';

function makeConfig(): ResolvedConfig {
  return {
    user: { email: undefined, userId: undefined },
    jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.imagile.dev', pat: 'tok' },
    github: { baseUrl: 'https://api.github.com', token: 'ghtok' },
    confluence: { baseUrl: 'https://conf.imagile.dev', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.imagile.dev', token: 'tok' },
    sde: { baseUrl: 'https://sde.imagile.dev', token: 'tok' },
    ado: { baseUrl: 'https://ado.imagile.dev', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    jenkins: { baseUrl: 'https://jenkins.imagile.dev', username: 'user', apiToken: 'tok' },
    udeploy: { baseUrl: undefined, pat: undefined, username: undefined, password: undefined },
    checkmarx: { baseUrl: undefined, tenantName: undefined, apiKey: undefined, clientId: undefined, clientSecret: undefined },
    servicenow: { baseUrl: undefined, username: undefined, password: undefined, apiToken: undefined },
    contrast: { baseUrl: undefined, orgUuid: undefined, apiKey: undefined, serviceKey: undefined, username: undefined },
    sonatypeiq: { baseUrl: undefined, userCode: undefined, passcode: undefined },
    openshift: { baseUrl: undefined, token: undefined },
    dynatrace: { baseUrl: undefined, apiToken: undefined, platformUrl: undefined, platformToken: undefined },
    logscale: { baseUrl: undefined, token: undefined },
    defaults: { jira: {}, bitbucket: {}, github: {}, sonar: {}, sde: {}, ado: {}, udeploy: {}, jenkins: {} }
  };
}

describe('GitHubClient — auth headers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends Authorization: Bearer, JSON Accept, and X-GitHub-Api-Version', async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.listPRs({ owner: 'o', repo: 'r' });

    expect(capturedHeaders['Authorization']).toBe('Bearer ghtok');
    expect(capturedHeaders['Accept']).toBe('application/vnd.github+json');
    expect(capturedHeaders['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

describe('GitHubClient — listPRs', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('paginates: fetches a second page when the first is full, then stops', async () => {
    const capturedUrls: string[] = [];
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
    const secondPage = [{ number: 101 }];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      const page = capturedUrls.length === 1 ? firstPage : secondPage;
      return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const prs = await client.listPRs({ owner: 'o', repo: 'r' });

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[0]).toContain('/repos/o/r/pulls');
    expect(capturedUrls[0]).toContain('page=1');
    expect(capturedUrls[1]).toContain('page=2');
    expect(prs).toHaveLength(101);
  });

  it('forwards the state filter to the query string', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.listPRs({ owner: 'o', repo: 'r', state: 'closed' });

    expect(capturedUrls[0]).toContain('state=closed');
  });
});

describe('GitHubClient — getDiff', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the diff Accept header and returns the raw text body', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedUrl = '';
    const diff = 'diff --git a/x b/x\n+line\n';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(diff, { status: 200 });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.getDiff('o', 'r', 7);

    expect(capturedUrl).toContain('/repos/o/r/pulls/7');
    expect(capturedHeaders['Accept']).toBe('application/vnd.github.v3.diff');
    expect(capturedHeaders['Authorization']).toBe('Bearer ghtok');
    expect(result).toBe(diff);
  });
});

describe('GitHubClient — listCheckRuns', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches from the commit check-runs URL and unwraps check_runs', async () => {
    const capturedUrls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      return new Response(
        JSON.stringify({ total_count: 1, check_runs: [{ name: 'ci' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const runs = await client.listCheckRuns('o', 'r', 'abc123');

    expect(capturedUrls).toHaveLength(1);
    expect(capturedUrls[0]).toContain('/repos/o/r/commits/abc123/check-runs');
    expect(runs).toEqual([{ name: 'ci' }]);
  });

  it('paginates when a full page of 100 runs is returned', async () => {
    const capturedUrls: string[] = [];
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `run-${i}` }));
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrls.push(url);
      const check_runs = capturedUrls.length === 1 ? fullPage : [{ name: 'last' }];
      return new Response(
        JSON.stringify({ total_count: 101, check_runs }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const runs = await client.listCheckRuns('o', 'r', 'abc123');

    expect(capturedUrls).toHaveLength(2);
    expect(capturedUrls[1]).toContain('page=2');
    expect(runs).toHaveLength(101);
  });
});

describe('GitHubClient — createPR', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs to the pulls endpoint with the PR body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createPR({ owner: 'o', repo: 'r', title: 'T', head: 'feature', base: 'main', body: 'B', draft: true });

    expect(capturedUrl).toContain('/repos/o/r/pulls');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ title: 'T', head: 'feature', base: 'main', body: 'B', draft: true });
  });
});

describe('GitHubClient — createIssue', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs to the issues endpoint with title, body, labels, and assignees', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 42 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createIssue({ owner: 'o', repo: 'r', title: 'Bug report', body: 'Details', labels: ['bug'], assignees: ['alice'] });

    expect(capturedUrl).toContain('/repos/o/r/issues');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ title: 'Bug report', body: 'Details', labels: ['bug'], assignees: ['alice'] });
  });

  it('omits optional fields when not provided', async () => {
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createIssue({ owner: 'o', repo: 'r', title: 'Minimal issue' });

    expect(capturedBody).toEqual({ title: 'Minimal issue' });
  });
});

describe('GitHubClient — createRepo', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs personal repositories to the authenticated user endpoint', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ name: 'personal-repo' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createRepo({ name: 'personal-repo' });

    expect(capturedUrl).toContain('/user/repos');
  });

  it('POSTs organization repositories to the requested organization endpoint', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ name: 'org-repo' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.createRepo({ org: 'my-org', name: 'org-repo' });

    expect(capturedUrl).toContain('/orgs/my-org/repos');
  });
});

describe('GitHubClient — listReviewThreads', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs GraphQL query to api.github.com/graphql and returns thread nodes', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: { query: string; variables: unknown } = { query: '', variables: {} };

    const thread = {
      id: 'PRT_kwDOHfWCIM4APCA',
      isResolved: false,
      isOutdated: false,
      path: 'src/index.ts',
      line: 10,
      comments: { nodes: [{ id: 'IC_1', databaseId: 1, body: 'fix this', author: { login: 'alice' }, createdAt: '2024-01-01T00:00:00Z' }] }
    };

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [thread] } } } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const threads = await client.listReviewThreads('o', 'r', 42);

    expect(capturedUrl).toBe('https://api.github.com/graphql');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody.variables).toEqual({ owner: 'o', repo: 'r', number: 42 });
    expect(capturedBody.query).toContain('reviewThreads');
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('PRT_kwDOHfWCIM4APCA');
    expect(threads[0].isResolved).toBe(false);
  });

  it('throws when the GraphQL response contains errors', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({ errors: [{ message: 'Could not resolve to a Repository' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await expect(client.listReviewThreads('o', 'r', 99)).rejects.toThrow('Could not resolve to a Repository');
  });
});

describe('GitHubClient — resolveReviewThread', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs resolveReviewThread mutation to api.github.com/graphql', async () => {
    let capturedUrl = '';
    let capturedBody: { query: string; variables: unknown } = { query: '', variables: {} };

    const thread = {
      id: 'PRT_kwDOHfWCIM4APCA',
      isResolved: true,
      isOutdated: false,
      path: 'src/index.ts',
      line: 10,
      comments: { nodes: [] }
    };

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ data: { resolveReviewThread: { thread } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.resolveReviewThread('PRT_kwDOHfWCIM4APCA');

    expect(capturedUrl).toBe('https://api.github.com/graphql');
    expect(capturedBody.query).toContain('resolveReviewThread');
    expect(capturedBody.variables).toEqual({ threadId: 'PRT_kwDOHfWCIM4APCA' });
    expect(result.isResolved).toBe(true);
  });
});

describe('GitHubClient — GraphQL endpoint derivation', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  async function capturedGraphQLUrl(baseUrl: string): Promise<string> {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const config = makeConfig();
    config.github.baseUrl = baseUrl;
    await new GitHubClient(new HttpClient(config)).listReviewThreads('o', 'r', 1);
    return capturedUrl;
  }

  it('derives /api/graphql for a GHES REST root', async () => {
    expect(await capturedGraphQLUrl('https://ghe.imagile.dev/api/v3')).toBe('https://ghe.imagile.dev/api/graphql');
  });

  it('derives /api/graphql for a GHES REST root with a trailing slash', async () => {
    expect(await capturedGraphQLUrl('https://ghe.imagile.dev/api/v3/')).toBe('https://ghe.imagile.dev/api/graphql');
  });

  it('derives /graphql for api.github.com with a trailing slash', async () => {
    expect(await capturedGraphQLUrl('https://api.github.com/')).toBe('https://api.github.com/graphql');
  });
});

describe('GitHubClient — GraphQL null data handling', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('throws a clean error when data is null and no errors array is present', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(JSON.stringify({ data: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await expect(client.listReviewThreads('o', 'r', 7)).rejects.toThrow('GraphQL response contained no data');
  });
});

describe('GitHubClient — listReviewThreads truncation', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('warns on stderr when more threads exist than were returned', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({
          data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [] } } } }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await new GitHubClient(new HttpClient(makeConfig())).listReviewThreads('o', 'r', 42);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('warning:'));
  });

  it('does not warn when hasNextPage is false', async () => {
    vi.stubGlobal('fetch', async () => {
      return new Response(
        JSON.stringify({
          data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await new GitHubClient(new HttpClient(makeConfig())).listReviewThreads('o', 'r', 42);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('GitHubClient — enableAutoMerge', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the PR node_id then POSTs the enablePullRequestAutoMerge mutation', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/graphql')) {
        bodies.push(JSON.parse(init.body as string));
        return new Response(
          JSON.stringify({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 5, autoMergeRequest: { mergeMethod: 'SQUASH', enabledAt: '2024-01-01T00:00:00Z', enabledBy: { login: 'alice' } } } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // REST call to get PR node_id
      return new Response(
        JSON.stringify({ number: 5, node_id: 'PR_node_123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.enableAutoMerge({ owner: 'o', repo: 'r', pullNumber: 5, mergeMethod: 'SQUASH' });

    expect(urls[0]).toContain('/repos/o/r/pulls/5');
    expect(urls[1]).toBe('https://api.github.com/graphql');
    const gqlBody = bodies[0] as { query: string; variables: Record<string, unknown> };
    expect(gqlBody.query).toContain('enablePullRequestAutoMerge');
    expect(gqlBody.variables.pullRequestId).toBe('PR_node_123');
    expect(gqlBody.variables.mergeMethod).toBe('SQUASH');
    expect(result.autoMergeRequest?.mergeMethod).toBe('SQUASH');
  });

  it('passes expectedHeadOid when --match-head-commit is provided', async () => {
    let capturedVars: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/graphql')) {
        capturedVars = JSON.parse(init.body as string).variables;
        return new Response(
          JSON.stringify({ data: { enablePullRequestAutoMerge: { pullRequest: { number: 7, autoMergeRequest: null } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ number: 7, node_id: 'PR_node_456' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    await client.enableAutoMerge({ owner: 'o', repo: 'r', pullNumber: 7, expectedHeadOid: 'abc123sha' });

    expect(capturedVars.expectedHeadOid).toBe('abc123sha');
  });
});

describe('GitHubClient — disableAutoMerge', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches the PR node_id then POSTs the disablePullRequestAutoMerge mutation', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(init.body as string);
        expect(body.query).toContain('disablePullRequestAutoMerge');
        expect(body.variables.pullRequestId).toBe('PR_node_789');
        return new Response(
          JSON.stringify({ data: { disablePullRequestAutoMerge: { pullRequest: { number: 3, autoMergeRequest: null } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ number: 3, node_id: 'PR_node_789' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.disableAutoMerge('o', 'r', 3);

    expect(urls).toHaveLength(2);
    expect(result.autoMergeRequest).toBeNull();
  });
});

describe('GitHubClient — enqueuePR', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs the addPullRequestToMergeQueue mutation and returns the queue URL', async () => {
    let capturedBody: { query: string; variables: Record<string, unknown> } = { query: '', variables: {} };
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/graphql')) {
        capturedBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({ data: { addPullRequestToMergeQueue: { mergeQueue: { url: 'https://github.com/o/r/queue' } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ number: 10, node_id: 'PR_node_enqueue' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const result = await client.enqueuePR({ owner: 'o', repo: 'r', pullNumber: 10, mergeMethod: 'MERGE' });

    expect(capturedBody.query).toContain('addPullRequestToMergeQueue');
    expect(capturedBody.variables.pullRequestId).toBe('PR_node_enqueue');
    expect(capturedBody.variables.mergeMethod).toBe('MERGE');
    expect(result.mergeQueueUrl).toBe('https://github.com/o/r/queue');
  });
});

describe('GitHubClient — getPRStatus', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('queries GraphQL and aggregates review, check, and auto-merge state', async () => {
    const prData = {
      number: 42,
      title: 'My PR',
      state: 'OPEN',
      isDraft: false,
      merged: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      autoMergeRequest: { mergeMethod: 'SQUASH', enabledAt: '2024-01-01T00:00:00Z', enabledBy: { login: 'bot' } },
      commits: {
        nodes: [{
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { __typename: 'CheckRun', name: 'ci', status: 'completed', conclusion: 'success' },
                  { __typename: 'CheckRun', name: 'lint', status: 'completed', conclusion: 'failure' },
                  { __typename: 'CheckRun', name: 'build', status: 'in_progress', conclusion: null },
                  { __typename: 'StatusContext', context: 'security', state: 'success' }
                ]
              }
            }
          }
        }]
      }
    };

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.github.com/graphql');
      const body = JSON.parse(init.body as string);
      expect(body.variables).toEqual({ owner: 'o', repo: 'r', number: 42 });
      return new Response(
        JSON.stringify({ data: { repository: { pullRequest: prData } } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const status = await client.getPRStatus('o', 'r', 42);

    expect(status.number).toBe(42);
    expect(status.reviewDecision).toBe('APPROVED');
    expect(status.autoMergeRequest?.enabledBy).toBe('bot');
    expect(status.checks.total).toBe(4);
    expect(status.checks.passed).toBe(2);
    expect(status.checks.failed).toBe(1);
    expect(status.checks.pending).toBe(1);
    expect(status.checks.other).toBe(0);
  });

  it('buckets skipped/cancelled/neutral checks into `other` so the counts sum to total', async () => {
    const prData = {
      number: 7,
      title: 'Mixed',
      state: 'OPEN',
      isDraft: false,
      merged: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: null,
      autoMergeRequest: null,
      commits: {
        nodes: [{
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { __typename: 'CheckRun', name: 'ci', status: 'completed', conclusion: 'success' },
                  { __typename: 'CheckRun', name: 'skipped-job', status: 'completed', conclusion: 'skipped' },
                  { __typename: 'CheckRun', name: 'cancelled-job', status: 'completed', conclusion: 'cancelled' },
                  { __typename: 'CheckRun', name: 'neutral-job', status: 'completed', conclusion: 'neutral' }
                ]
              }
            }
          }
        }]
      }
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ data: { repository: { pullRequest: prData } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const status = await client.getPRStatus('o', 'r', 7);

    expect(status.checks.total).toBe(4);
    expect(status.checks.passed).toBe(1);
    expect(status.checks.failed).toBe(0);
    expect(status.checks.pending).toBe(0);
    expect(status.checks.other).toBe(3);
    expect(status.checks.passed + status.checks.failed + status.checks.pending + status.checks.other)
      .toBe(status.checks.total);
  });

  it('handles a PR with no checks', async () => {
    const prData = {
      number: 1,
      title: 'Minimal',
      state: 'OPEN',
      isDraft: true,
      merged: false,
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'DRAFT',
      reviewDecision: null,
      autoMergeRequest: null,
      commits: { nodes: [{ commit: { statusCheckRollup: null } }] }
    };

    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ data: { repository: { pullRequest: prData } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const client = new GitHubClient(new HttpClient(makeConfig()));
    const status = await client.getPRStatus('o', 'r', 1);

    expect(status.checks.total).toBe(0);
    expect(status.autoMergeRequest).toBeNull();
  });
});

describe('GitHubClient — convertToDraft / markReadyForReview', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('convertToDraft POSTs the convertPullRequestToDraft mutation', async () => {
    let capturedQuery = '';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/graphql')) {
        capturedQuery = JSON.parse(init.body as string).query;
        return new Response(
          JSON.stringify({ data: { convertPullRequestToDraft: { pullRequest: { number: 8, isDraft: true } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ number: 8, node_id: 'PR_node_draft' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const result = await new GitHubClient(new HttpClient(makeConfig())).convertToDraft('o', 'r', 8);
    expect(capturedQuery).toContain('convertPullRequestToDraft');
    expect(result.isDraft).toBe(true);
  });

  it('markReadyForReview POSTs the markPullRequestReadyForReview mutation', async () => {
    let capturedQuery = '';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/graphql')) {
        capturedQuery = JSON.parse(init.body as string).query;
        return new Response(
          JSON.stringify({ data: { markPullRequestReadyForReview: { pullRequest: { number: 9, isDraft: false } } } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ number: 9, node_id: 'PR_node_ready' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const result = await new GitHubClient(new HttpClient(makeConfig())).markReadyForReview('o', 'r', 9);
    expect(capturedQuery).toContain('markPullRequestReadyForReview');
    expect(result.isDraft).toBe(false);
  });
});

describe('GitHubClient — addLabels / removeLabel', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('addLabels POSTs to the issues labels endpoint', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ labels: [{ name: 'bug' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).addLabels('o', 'r', 5, ['bug', 'enhancement']);
    expect(capturedUrl).toContain('/repos/o/r/issues/5/labels');
    expect(capturedBody).toEqual({ labels: ['bug', 'enhancement'] });
  });

  it('removeLabel sends DELETE to the label endpoint', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init.method ?? 'GET';
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).removeLabel('o', 'r', 5, 'bug');
    expect(capturedUrl).toContain('/repos/o/r/issues/5/labels/bug');
    expect(capturedMethod).toBe('DELETE');
  });

  it('removeLabel URL-encodes the label name via the URL constructor', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).removeLabel('o', 'r', 5, 'help wanted');
    expect(capturedUrl).toContain('/labels/help%20wanted');
  });
});

describe('GitHubClient — addReviewers / removeReviewers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('addReviewers POSTs to requested_reviewers with user and team slugs', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ url: 'https://api.github.com/repos/o/r/pulls/3' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).addReviewers({ owner: 'o', repo: 'r', pullNumber: 3, reviewers: ['alice'], teamReviewers: ['backend-team'] });
    expect(capturedUrl).toContain('/repos/o/r/pulls/3/requested_reviewers');
    expect(capturedBody).toEqual({ reviewers: ['alice'], team_reviewers: ['backend-team'] });
  });

  it('removeReviewers sends DELETE to requested_reviewers', async () => {
    let capturedMethod = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedMethod = init.method ?? 'GET';
      return new Response('', { status: 200 });
    });

    await new GitHubClient(new HttpClient(makeConfig())).removeReviewers({ owner: 'o', repo: 'r', pullNumber: 3, reviewers: ['bob'] });
    expect(capturedMethod).toBe('DELETE');
  });
});

describe('GitHubClient — addAssignees / removeAssignees', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('addAssignees POSTs to the issues assignees endpoint', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ number: 7, assignees: [{ login: 'alice' }] }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).addAssignees('o', 'r', 7, ['alice']);
    expect(capturedUrl).toContain('/repos/o/r/issues/7/assignees');
    expect(capturedBody).toEqual({ assignees: ['alice'] });
  });

  it('removeAssignees sends DELETE to the assignees endpoint', async () => {
    let capturedMethod = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      capturedMethod = init.method ?? 'GET';
      return new Response(JSON.stringify({ number: 7 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await new GitHubClient(new HttpClient(makeConfig())).removeAssignees('o', 'r', 7, ['bob']);
    expect(capturedMethod).toBe('DELETE');
  });
});
