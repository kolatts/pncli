import { describe, it, expect, vi } from 'vitest';
import { JenkinsClient } from './client.js';
import type { HttpClient } from '../../lib/http.js';

function makeHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    jenkins: vi.fn(),
    jenkinsRaw: vi.fn(),
    ...overrides
  } as unknown as HttpClient;
}

describe('JenkinsClient — listJobs', () => {
  it('queries root-level endpoint when no folder is specified', async () => {
    const jobs = [{ name: 'my-job', url: 'http://j/job/my-job/', color: 'blue', description: null, buildable: true, lastBuild: null }];
    const http = makeHttp({ jenkins: vi.fn().mockResolvedValue({ jobs }) });
    const client = new JenkinsClient(http);

    const result = await client.listJobs();

    expect(http.jenkins).toHaveBeenCalledWith('/api/json', expect.objectContaining({}));
    expect(result).toEqual(jobs);
  });

  it('queries folder endpoint when a folder name is specified', async () => {
    const jobs = [{ name: 'inner-job', url: 'http://j/job/my-folder/job/inner-job/', color: 'blue', description: null, buildable: true, lastBuild: null }];
    const http = makeHttp({ jenkins: vi.fn().mockResolvedValue({ jobs }) });
    const client = new JenkinsClient(http);

    const result = await client.listJobs('my-folder');

    expect(http.jenkins).toHaveBeenCalledWith('/job/my-folder/api/json', expect.objectContaining({}));
    expect(result).toEqual(jobs);
  });

  it('encodes nested folder paths correctly', async () => {
    const jobs: never[] = [];
    const http = makeHttp({ jenkins: vi.fn().mockResolvedValue({ jobs }) });
    const client = new JenkinsClient(http);

    await client.listJobs('parent/child');

    expect(http.jenkins).toHaveBeenCalledWith('/job/parent/job/child/api/json', expect.objectContaining({}));
  });
});

describe('JenkinsClient — listBuilds', () => {
  it('constructs correct URL for a folder-scoped job', async () => {
    const builds = [{ number: 1, url: '', result: 'SUCCESS', duration: 1000, timestamp: 0, building: false, displayName: '#1', fullDisplayName: 'folder/job #1', description: null, id: '1', queueId: 10 }];
    const http = makeHttp({ jenkins: vi.fn().mockResolvedValue({ builds }) });
    const client = new JenkinsClient(http);

    const result = await client.listBuilds('my-folder/my-job');

    expect(http.jenkins).toHaveBeenCalledWith('/job/my-folder/job/my-job/api/json', expect.objectContaining({}));
    expect(result).toEqual(builds);
  });

  it('constructs correct URL for a single-level job', async () => {
    const http = makeHttp({ jenkins: vi.fn().mockResolvedValue({ builds: [] }) });
    const client = new JenkinsClient(http);

    await client.listBuilds('simple-job');

    expect(http.jenkins).toHaveBeenCalledWith('/job/simple-job/api/json', expect.objectContaining({}));
  });
});
