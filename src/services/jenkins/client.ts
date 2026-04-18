import type { HttpClient } from '../../lib/http.js';
import { PncliError } from '../../lib/errors.js';
import type {
  JenkinsJob,
  JenkinsJobDetail,
  JenkinsBuild,
  JenkinsListJobsResponse,
  JenkinsQueueItem
} from '../../types/jenkins.js';

/** Converts a multi-level Jenkins job name (e.g. `A/B/C`) into the correct
 *  URL path segment (e.g. `A/job/B/job/C`). Single-level names are unchanged.
 *  Each segment is individually percent-encoded. */
function jobPath(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/job/');
}

export class JenkinsClient {
  constructor(private http: HttpClient) {}

  async listJobs(): Promise<JenkinsJob[]> {
    const data = await this.http.jenkins<JenkinsListJobsResponse>(
      '/api/json',
      { params: { tree: 'jobs[name,url,color,description,buildable,lastBuild[number,url,result]]' } }
    );
    return data.jobs;
  }

  async getJob(name: string): Promise<JenkinsJobDetail> {
    return this.http.jenkins<JenkinsJobDetail>(
      `/job/${jobPath(name)}/api/json`,
      { params: { tree: 'name,url,color,description,buildable,nextBuildNumber,inQueue,lastBuild[number,url,result],builds[number,url,result,duration,timestamp,building,displayName]{0,10}' } }
    );
  }

  async triggerBuild(
    name: string,
    params?: Record<string, string>
  ): Promise<{ queueItemId: number }> {
    const hasParams = params && Object.keys(params).length > 0;
    const endpoint = hasParams
      ? `/job/${jobPath(name)}/buildWithParameters`
      : `/job/${jobPath(name)}/build`;

    const res = await this.http.jenkinsRaw(endpoint, {
      method: 'POST',
      params: hasParams ? params : undefined
    });

    const location = res.headers.get('Location') ?? '';
    const match = location.match(/\/queue\/item\/(\d+)\/?$/);
    if (!match) throw new PncliError('Build queued but Jenkins did not return a Location header — cannot track queue item');
    const queueItemId = parseInt(match[1]!, 10);
    return { queueItemId };
  }

  async getQueueItem(queueItemId: number): Promise<JenkinsQueueItem> {
    return this.http.jenkins<JenkinsQueueItem>(`/queue/item/${queueItemId}/api/json`);
  }

  async listBuilds(name: string, top = 25): Promise<Pick<JenkinsBuild, 'number' | 'url' | 'result' | 'duration' | 'timestamp' | 'building' | 'displayName' | 'fullDisplayName' | 'description' | 'id' | 'queueId'>[]> {
    const data = await this.http.jenkins<{ builds: Pick<JenkinsBuild, 'number' | 'url' | 'result' | 'duration' | 'timestamp' | 'building' | 'displayName' | 'fullDisplayName' | 'description' | 'id' | 'queueId'>[] }>(
      `/job/${jobPath(name)}/api/json`,
      { params: { tree: `builds[number,url,result,duration,timestamp,building,displayName,fullDisplayName,description,id,queueId]{0,${top}}` } }
    );
    return data.builds ?? [];
  }

  async getBuild(name: string, buildNumber: number): Promise<JenkinsBuild> {
    return this.http.jenkins<JenkinsBuild>(
      `/job/${jobPath(name)}/${buildNumber}/api/json`
    );
  }

  async getConsoleLog(name: string, buildNumber: number): Promise<string> {
    const res = await this.http.jenkinsRaw(
      `/job/${jobPath(name)}/${buildNumber}/consoleText`,
      { method: 'GET' }
    );
    return res.text;
  }
}
