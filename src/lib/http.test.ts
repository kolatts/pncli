import { describe, it, expect } from 'vitest';
import { HttpClient } from './http.js';
import type { ResolvedConfig } from '../types/config.js';

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    user: {},
    jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok', customFields: [] },
    bitbucket: { baseUrl: 'https://bb.example.com', pat: 'tok' },
    confluence: { baseUrl: 'https://conf.example.com', apiToken: 'tok', apiTokenExplicit: true },
    artifactory: {},
    sonar: { baseUrl: 'https://sonar.example.com', token: 'tok' },
    sde: { baseUrl: 'https://sde.example.com', token: 'tok' },
    ado: { baseUrl: 'https://ado.example.com', pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] },
    defaults: { jira: {}, bitbucket: {}, sonar: {}, sde: {}, ado: {} },
    ...overrides
  };
}

describe('HttpClient — dry-run', () => {
  it('throws PncliError with status 0 on jira dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ status: 0, message: 'dry-run' });
  });

  it('throws PncliError with status 0 on bitbucket dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ status: 0 });
  });

  it('throws PncliError with status 0 on sonar dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.sonar('/api/issues/search')).rejects.toMatchObject({ status: 0 });
  });

  it('throws PncliError with status 0 on ado dry-run', async () => {
    const client = new HttpClient(baseConfig(), true);
    await expect(client.ado('/_apis/projects')).rejects.toMatchObject({ status: 0 });
  });
});

describe('HttpClient — missing credentials', () => {
  it('throws on missing jira baseUrl', async () => {
    const client = new HttpClient(baseConfig({ jira: { apiToken: 'tok', customFields: [] } }));
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing jira apiToken', async () => {
    const client = new HttpClient(baseConfig({ jira: { baseUrl: 'https://jira.example.com', customFields: [] } }));
    await expect(client.jira('/rest/api/2/issue/TEST-1')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing bitbucket baseUrl', async () => {
    const client = new HttpClient(baseConfig({ bitbucket: { pat: 'tok' } }));
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing bitbucket pat', async () => {
    const client = new HttpClient(baseConfig({ bitbucket: { baseUrl: 'https://bb.example.com' } }));
    await expect(client.bitbucket('/rest/api/1.0/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });

  it('throws on missing ado baseUrl', async () => {
    const client = new HttpClient(baseConfig({ ado: { pat: 'tok', fieldAliases: {}, discoveredFields: [], discoveredTypes: [] } }));
    await expect(client.ado('/_apis/projects')).rejects.toMatchObject({ name: 'PncliError' });
  });
});

describe('HttpClient — sdePaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.sdePaginate(async () => ({ count: 2, results: ['a', 'b'] }));
    expect(results).toEqual(['a', 'b']);
  });

  it('collects multiple pages', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.sdePaginate(async () => {
      call++;
      if (call === 1) return { count: 3, results: ['a', 'b'] };
      return { count: 3, results: ['c'] };
    });
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('stops when results length reaches count', async () => {
    const client = new HttpClient(baseConfig());
    let calls = 0;
    await client.sdePaginate(async () => {
      calls++;
      return { count: 1, results: ['x'] };
    });
    expect(calls).toBe(1);
  });
});

describe('HttpClient — sonarPaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.sonarPaginate(async () => ({ total: 2, p: 1, ps: 500, items: [1, 2] }));
    expect(results).toEqual([1, 2]);
  });

  it('collects multiple pages', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.sonarPaginate(async () => {
      call++;
      if (call === 1) return { total: 3, p: 1, ps: 2, items: [1, 2] };
      return { total: 3, p: 2, ps: 2, items: [3] };
    });
    expect(results).toEqual([1, 2, 3]);
  });
});

describe('HttpClient — paginate (Bitbucket)', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.paginate(async () => ({ values: ['a'], isLastPage: true }));
    expect(results).toEqual(['a']);
  });

  it('collects multiple pages using nextPageStart', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.paginate(async (start) => {
      call++;
      if (start === 0) return { values: ['a', 'b'], isLastPage: false, nextPageStart: 2 };
      return { values: ['c'], isLastPage: true };
    });
    expect(results).toEqual(['a', 'b', 'c']);
  });
});

describe('HttpClient — jiraPaginate', () => {
  it('collects issues across pages', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.jiraPaginate(async () => {
      call++;
      if (call === 1) return { issues: ['A', 'B'], total: 3, startAt: 0, maxResults: 100 };
      return { issues: ['C'], total: 3, startAt: 2, maxResults: 100 };
    });
    expect(results).toEqual(['A', 'B', 'C']);
  });

  it('works with values field instead of issues', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.jiraPaginate(async () => ({ values: ['X'], total: 1, startAt: 0, maxResults: 100 }));
    expect(results).toEqual(['X']);
  });
});

describe('HttpClient — adoPaginate', () => {
  it('collects single page without continuation token', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.adoPaginate(async () => ({
      data: { value: ['a', 'b'] },
      headers: new Headers()
    }));
    expect(results).toEqual(['a', 'b']);
  });

  it('follows continuation tokens', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.adoPaginate(async () => {
      call++;
      if (call === 1) {
        const h = new Headers({ 'x-ms-continuationtoken': 'tok2' });
        return { data: { value: ['a'] }, headers: h };
      }
      return { data: { value: ['b'] }, headers: new Headers() };
    });
    expect(results).toEqual(['a', 'b']);
  });
});

describe('HttpClient — confluencePaginate', () => {
  it('collects single page', async () => {
    const client = new HttpClient(baseConfig());
    const results = await client.confluencePaginate(async () => ({
      results: ['x'],
      start: 0,
      limit: 25,
      size: 1,
      _links: {}
    }));
    expect(results).toEqual(['x']);
  });

  it('follows next links', async () => {
    const client = new HttpClient(baseConfig());
    let call = 0;
    const results = await client.confluencePaginate(async () => {
      call++;
      if (call === 1) return { results: ['x'], start: 0, limit: 25, size: 25, _links: { next: '/next' } };
      return { results: ['y'], start: 25, limit: 25, size: 1, _links: {} };
    });
    expect(results).toEqual(['x', 'y']);
  });
});
