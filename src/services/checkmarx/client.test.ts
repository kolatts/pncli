import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../../lib/http.js';
import { CheckmarxClient } from './client.js';

function makeClient(response: unknown): {
  client: CheckmarxClient;
  checkmarx: ReturnType<typeof vi.fn>;
} {
  const checkmarx = vi.fn().mockResolvedValue(response);
  const http = { checkmarx } as unknown as HttpClient;
  return { client: new CheckmarxClient(http), checkmarx };
}

describe('CheckmarxClient', () => {
  it('returns an empty project list when Checkmarx responds with null', async () => {
    const { client, checkmarx } = makeClient({
      projects: null,
      totalCount: 0,
      filteredTotalCount: 0
    });

    await expect(client.listProjects()).resolves.toEqual([]);
    expect(checkmarx).toHaveBeenCalledWith('/api/projects', { params: { limit: 100 } });
  });

  it('returns an empty scan list when Checkmarx responds with null', async () => {
    const { client, checkmarx } = makeClient({
      scans: null,
      totalCount: 0,
      filteredTotalCount: 0
    });

    await expect(client.listScans({ projectId: 'project-id', last: 25 })).resolves.toEqual([]);
    expect(checkmarx).toHaveBeenCalledWith('/api/scans', {
      params: { limit: 25, 'project-id': 'project-id' }
    });
  });
});
