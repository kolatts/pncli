import type { HttpClient } from '../../lib/http.js';
import type {
  JenkinsJob,
  JenkinsJobDetail,
  JenkinsBuild,
  JenkinsCrumb,
  JenkinsTriggerResponse
} from '../../types/jenkins.js';

const TREE_JOB_LIST = 'jobs[name,url,color,description,buildable,fullName,lastBuild[number,url],lastCompletedBuild[number,url],lastSuccessfulBuild[number,url],lastFailedBuild[number,url]]';

export interface ListBuildsOpts {
  top?: number;
}

export interface TriggerOpts {
  parameters?: Record<string, string>;
}

export class JenkinsClient {
  constructor(private http: HttpClient) {}

  // ── Jobs ──────────────────────────────────────────────────────────

  async listJobs(): Promise<JenkinsJob[]> {
    const result = await this.http.jenkins<{ jobs: JenkinsJob[] }>(`/api/json`, {
      params: { tree: TREE_JOB_LIST }
    });
    return result.jobs ?? [];
  }

  async getJob(name: string): Promise<JenkinsJobDetail> {
    const buildTree = 'builds[number,url,displayName,result,building,duration,timestamp]{0,20}';
    return this.http.jenkins<JenkinsJobDetail>(`/job/${encodeURIComponent(name)}/api/json`, {
      params: {
        tree: `name,url,color,description,buildable,fullName,healthReport[description,score],${buildTree},lastBuild[number,url],lastCompletedBuild[number,url],lastSuccessfulBuild[number,url],lastFailedBuild[number,url]`
      }
    });
  }

  // ── Builds ────────────────────────────────────────────────────────

  async listBuilds(jobName: string, opts: ListBuildsOpts = {}): Promise<JenkinsBuild[]> {
    const top = opts.top ?? 50;
    const result = await this.http.jenkins<{ builds: JenkinsBuild[] }>(
      `/job/${encodeURIComponent(jobName)}/api/json`,
      {
        params: {
          tree: `builds[number,url,displayName,fullDisplayName,result,building,duration,estimatedDuration,timestamp,description,causes[shortDescription]]{0,${top}}`
        }
      }
    );
    return result.builds ?? [];
  }

  async getBuild(jobName: string, buildNumber: number): Promise<JenkinsBuild> {
    return this.http.jenkins<JenkinsBuild>(
      `/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json`
    );
  }

  async getBuildLog(jobName: string, buildNumber: number): Promise<string> {
    return this.http.jenkinsText(
      `/job/${encodeURIComponent(jobName)}/${buildNumber}/consoleText`
    );
  }

  // ── Trigger ───────────────────────────────────────────────────────

  private async getCrumb(): Promise<JenkinsCrumb | null> {
    try {
      return await this.http.jenkins<JenkinsCrumb>('/crumbIssuer/api/json');
    } catch {
      // CSRF crumbs may be disabled — silently ignore
      return null;
    }
  }

  async trigger(jobName: string, opts: TriggerOpts = {}): Promise<JenkinsTriggerResponse> {
    const crumb = await this.getCrumb();
    const extraHeaders: Record<string, string> = {};
    if (crumb) {
      extraHeaders[crumb.crumbRequestField] = crumb.crumb;
    }

    const hasParams = opts.parameters && Object.keys(opts.parameters).length > 0;
    const endpoint = hasParams
      ? `/job/${encodeURIComponent(jobName)}/buildWithParameters`
      : `/job/${encodeURIComponent(jobName)}/build`;

    const location = await this.http.jenkinsTrigger(endpoint, {
      headers: extraHeaders,
      params: hasParams ? opts.parameters : undefined
    });

    return { location: location ?? undefined };
  }
}
