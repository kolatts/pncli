import { createHttpClient } from '../../lib/http.js';
import type { ResolvedConfig } from '../../types/config.js';
import { checkArtifactoryConnectivity } from '../deps/clients/artifactory.js';

export type CheckStatus = 'blank' | 'valid' | 'invalid' | 'error';
export interface CheckResult { status: CheckStatus; message: string }

type HttpClient = ReturnType<typeof createHttpClient>;

/**
 * Validates every configured credential by hitting a cheap authenticated
 * endpoint per service. Extracted from the `config check` command action so
 * `pncli doctor` can run the same checks; `config check` remains the
 * user-facing command and owns output formatting and exit codes.
 *
 * Statuses: `blank` = not configured, `valid` = auth accepted,
 * `invalid` = auth rejected (401/403), `error` = anything else (bad baseUrl,
 * network failure, timeout).
 */
export async function runCredentialChecks(cfg: ResolvedConfig, http: HttpClient): Promise<Record<string, CheckResult>> {
  const results: Record<string, CheckResult> = {};

  function categorize(err: unknown): CheckResult {
    const status = (err as { status?: number }).status ?? -1;
    if (status === 401 || status === 403) {
      return { status: 'invalid', message: `auth rejected (${status})` };
    }
    if (status === 0) {
      return { status: 'error', message: (err instanceof Error ? err.message : String(err)) };
    }
    return { status: 'error', message: (err instanceof Error ? err.message : String(err)) };
  }

  // Jira
  if (!cfg.jira.apiToken) {
    results.jira = { status: 'blank', message: 'not configured' };
  } else if (!cfg.jira.baseUrl) {
    results.jira = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.jira<unknown>('/rest/api/2/myself', { timeoutMs: 10_000 });
      results.jira = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.jira = categorize(err);
    }
  }

  // Bitbucket
  if (!cfg.bitbucket.pat) {
    results.bitbucket = { status: 'blank', message: 'not configured' };
  } else if (!cfg.bitbucket.baseUrl) {
    results.bitbucket = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.bitbucket<unknown>('/rest/api/1.0/application-properties', { timeoutMs: 10_000 });
      results.bitbucket = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.bitbucket = categorize(err);
    }
  }

  // GitHub
  if (!cfg.github.token) {
    results.github = { status: 'blank', message: 'not configured' };
  } else if (!cfg.github.baseUrl) {
    results.github = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.github<unknown>('/user', { timeoutMs: 10_000 });
      results.github = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.github = categorize(err);
    }
  }

  // Confluence — distinguish explicit token from Jira fallback
  if (!cfg.confluence.apiTokenExplicit && !cfg.jira.apiToken) {
    results.confluence = { status: 'blank', message: 'not configured' };
  } else if (!cfg.confluence.apiToken) {
    results.confluence = { status: 'blank', message: 'not configured' };
  } else if (!cfg.confluence.baseUrl) {
    results.confluence = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.confluence<unknown>('/rest/api/space', { params: { limit: 1 }, timeoutMs: 10_000 });
      const msg = cfg.confluence.apiTokenExplicit ? 'ok' : 'ok (inherited from Jira token)';
      results.confluence = { status: 'valid', message: msg };
    } catch (err) {
      results.confluence = categorize(err);
    }
  }

  // SonarQube
  if (!cfg.sonar.token) {
    results.sonar = { status: 'blank', message: 'not configured' };
  } else if (!cfg.sonar.baseUrl) {
    results.sonar = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.sonar<unknown>('/api/system/status', { timeoutMs: 10_000 });
      results.sonar = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.sonar = categorize(err);
    }
  }

  // SDElements
  if (!cfg.sde.token) {
    results.sde = { status: 'blank', message: 'not configured' };
  } else if (!cfg.sde.baseUrl) {
    results.sde = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.sde<unknown>('/api/v2/users/me/', { timeoutMs: 10_000 });
      results.sde = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.sde = categorize(err);
    }
  }

  // Azure DevOps
  if (!cfg.ado.pat) {
    results.ado = { status: 'blank', message: 'not configured' };
  } else if (!cfg.ado.baseUrl) {
    results.ado = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      const collection = cfg.defaults.ado?.collection;
      const path = collection
        ? `/${encodeURIComponent(collection)}/_apis/connectionData?api-version=7.1-preview.1`
        : '/_apis/projectCollections?api-version=7.1';
      await http.ado<unknown>(path, { timeoutMs: 10_000 });
      results.ado = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.ado = categorize(err);
    }
  }

  // Jenkins
  if (!cfg.jenkins.apiToken || !cfg.jenkins.username) {
    results.jenkins = { status: 'blank', message: 'not configured' };
  } else if (!cfg.jenkins.baseUrl) {
    results.jenkins = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.jenkins<unknown>('/api/json', { params: { tree: 'nodeName' }, timeoutMs: 10_000 });
      results.jenkins = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.jenkins = categorize(err);
    }
  }

  // Artifactory — reuse existing helper
  const artResult = await checkArtifactoryConnectivity(cfg.artifactory);
  if (!artResult.configured) {
    results.artifactory = { status: 'blank', message: artResult.error ?? 'not configured' };
  } else if (!artResult.authenticated) {
    results.artifactory = { status: 'invalid', message: artResult.error ?? 'auth rejected' };
  } else if (!artResult.reachable) {
    results.artifactory = { status: 'error', message: artResult.error ?? 'unreachable' };
  } else {
    results.artifactory = { status: 'valid', message: 'ok' };
  }

  // Checkmarx
  if (!cfg.checkmarx.tenantName || (!cfg.checkmarx.apiKey && (!cfg.checkmarx.clientId || !cfg.checkmarx.clientSecret))) {
    results.checkmarx = { status: 'blank', message: 'not configured' };
  } else if (!cfg.checkmarx.baseUrl) {
    results.checkmarx = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.checkmarx<unknown>('projects', { params: { limit: 1 }, timeoutMs: 10_000 });
      results.checkmarx = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.checkmarx = categorize(err);
    }
  }

  // ServiceNow
  const snCreds = cfg.servicenow.username && (cfg.servicenow.password || cfg.servicenow.apiToken);
  if (!snCreds) {
    results.servicenow = { status: 'blank', message: 'not configured' };
  } else if (!cfg.servicenow.baseUrl) {
    results.servicenow = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.servicenow<unknown>('/api/now/table/change_request', { params: { sysparm_limit: 1 }, timeoutMs: 10_000 });
      results.servicenow = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.servicenow = categorize(err);
    }
  }

  // Contrast IAST
  if (!cfg.contrast.apiKey || !cfg.contrast.serviceKey || !cfg.contrast.username) {
    results.contrast = { status: 'blank', message: 'not configured' };
  } else if (!cfg.contrast.orgUuid) {
    results.contrast = { status: 'error', message: 'orgUuid not configured' };
  } else {
    try {
      await http.contrast<unknown>(`/Contrast/api/ng/${cfg.contrast.orgUuid}/applications`, { params: { limit: 1 }, timeoutMs: 10_000 });
      results.contrast = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.contrast = categorize(err);
    }
  }

  // Sonatype IQ Server
  if (!cfg.sonatypeiq.userCode || !cfg.sonatypeiq.passcode) {
    results.sonatypeiq = { status: 'blank', message: 'not configured' };
  } else if (!cfg.sonatypeiq.baseUrl) {
    results.sonatypeiq = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.sonatypeiq<unknown>('/api/v2/applications', { params: { limit: 1 }, timeoutMs: 10_000 });
      results.sonatypeiq = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.sonatypeiq = categorize(err);
    }
  }

  // OpenShift / Kubernetes (flat legacy config)
  if (!cfg.openshift.token) {
    results.openshift = { status: 'blank', message: 'not configured' };
  } else if (!cfg.openshift.baseUrl) {
    results.openshift = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.openshift<unknown>('/api/v1', { timeoutMs: 10_000 });
      results.openshift = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.openshift = categorize(err);
    }
  }

  // OpenShift named environments/instances
  for (const [envName, envCfg] of Object.entries(cfg.openshift.environments)) {
    for (const [instName, instCfg] of Object.entries(envCfg.instances ?? {})) {
      const key = `openshift:${envName}/${instName}`;
      if (!instCfg.token) {
        results[key] = { status: 'blank', message: 'token not configured' };
      } else if (!instCfg.baseUrl) {
        results[key] = { status: 'error', message: 'baseUrl not configured' };
      } else {
        const clusterHttp = createHttpClient(
          { ...cfg, openshift: { ...cfg.openshift, baseUrl: instCfg.baseUrl, token: instCfg.token } },
          false
        );
        try {
          await clusterHttp.openshift<unknown>('/api/v1', { timeoutMs: 10_000 });
          results[key] = { status: 'valid', message: 'ok' };
        } catch (err) {
          results[key] = categorize(err);
        }
      }
    }
  }

  if (!cfg.dynatrace.apiToken) {
    if (Object.keys(cfg.dynatrace.environments).length === 0) {
      results.dynatrace = { status: 'blank', message: 'not configured' };
    } else {
      results.dynatrace = { status: 'blank', message: 'flat config not set — see named environments below' };
    }
  } else if (!cfg.dynatrace.baseUrl) {
    results.dynatrace = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.dynatrace<unknown>('/api/v2/entities', {
        params: { entitySelector: 'type("SERVICE")', pageSize: 1 },
        timeoutMs: 10_000
      });
      results.dynatrace = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.dynatrace = categorize(err);
    }
  }

  if (!cfg.dynatrace.platformUrl && !cfg.dynatrace.platformToken) {
    results.dynatrace_platform = { status: 'blank', message: 'not configured' };
  } else if (!cfg.dynatrace.platformUrl || !cfg.dynatrace.platformToken) {
    results.dynatrace_platform = {
      status: 'error',
      message: 'platformUrl and platformToken must both be configured'
    };
  } else {
    try {
      await http.dynatracePlatform<unknown>('/platform/storage/query/v1/query:execute', {
        method: 'POST',
        body: {
          query: 'fetch spans | limit 1',
          requestTimeoutMilliseconds: 5000
        },
        timeoutMs: 10_000
      });
      results.dynatrace_platform = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.dynatrace_platform = categorize(err);
    }
  }

  // Named Dynatrace environments
  for (const [envName, envConfig] of Object.entries(cfg.dynatrace.environments)) {
    const envHttp = createHttpClient({
      ...cfg,
      dynatrace: {
        ...cfg.dynatrace,
        baseUrl: envConfig.baseUrl,
        apiToken: envConfig.apiToken,
        platformUrl: envConfig.platformUrl,
        platformToken: envConfig.platformToken
      }
    }, false);
    const key = `dynatrace.${envName}`;
    if (!envConfig.apiToken) {
      results[key] = { status: 'blank', message: 'apiToken not configured' };
    } else if (!envConfig.baseUrl) {
      results[key] = { status: 'error', message: 'baseUrl not configured' };
    } else {
      try {
        await envHttp.dynatrace<unknown>('/api/v2/entities', {
          params: { entitySelector: 'type("SERVICE")', pageSize: 1 },
          timeoutMs: 10_000
        });
        results[key] = { status: 'valid', message: 'ok' };
      } catch (err) {
        results[key] = categorize(err);
      }
    }

    const platformKey = `dynatrace.${envName}_platform`;
    if (envConfig.platformUrl && envConfig.platformToken) {
      try {
        await envHttp.dynatracePlatform<unknown>('/platform/storage/query/v1/query:execute', {
          method: 'POST',
          body: { query: 'fetch spans | limit 1', requestTimeoutMilliseconds: 5000 },
          timeoutMs: 10_000
        });
        results[platformKey] = { status: 'valid', message: 'ok' };
      } catch (err) {
        results[platformKey] = categorize(err);
      }
    } else if (envConfig.platformUrl || envConfig.platformToken) {
      results[platformKey] = {
        status: 'error',
        message: 'platformUrl and platformToken must both be configured'
      };
    }
  }

  // LogScale
  if (!cfg.logscale.token) {
    results.logscale = { status: 'blank', message: 'not configured' };
  } else if (!cfg.logscale.baseUrl) {
    results.logscale = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.logscale<unknown[]>('/api/v1/repositories', { timeoutMs: 10_000 });
      results.logscale = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.logscale = categorize(err);
    }
  }

  // Split.IO
  if (!cfg.splitio.adminApiKey) {
    results.splitio = { status: 'blank', message: 'not configured' };
  } else if (!cfg.splitio.baseUrl) {
    results.splitio = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.splitio<unknown>('/internal/api/v2/workspaces', { timeoutMs: 10_000 });
      results.splitio = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.splitio = categorize(err);
    }
  }

  // Figma
  if (!cfg.figma.token) {
    results.figma = { status: 'blank', message: 'not configured' };
  } else if (!cfg.figma.baseUrl) {
    results.figma = { status: 'error', message: 'baseUrl not configured' };
  } else {
    try {
      await http.figma<unknown>('/v1/me', { timeoutMs: 10_000 });
      results.figma = { status: 'valid', message: 'ok' };
    } catch (err) {
      results.figma = categorize(err);
    }
  }

  return results;
}
