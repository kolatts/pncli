import { execSync } from 'child_process';
import type { ResolvedConfig } from '../types/config.js';

export interface GitContext {
  root: string;
  branch: string;
  // Bitbucket-resolved fields
  project: string | null;
  repo: string | null;
  // Azure DevOps Server-resolved fields
  ado: { collection: string; project: string; repo: string } | null;
  // GitHub-resolved fields
  github: { owner: string; repo: string } | null;
}

export function getRepoRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function getCurrentBranch(repoRoot: string): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      cwd: repoRoot
    }).trim();
  } catch {
    return null;
  }
}

export function parseRemote(
  remoteUrl: string,
  bitbucketBaseUrl: string | undefined
): { project: string; repo: string } | null {
  if (!bitbucketBaseUrl) return null;

  // Normalize base URL for comparison
  const base = bitbucketBaseUrl.replace(/\/$/, '').replace(/^https?:\/\//, '');

  // SSH format: git@bitbucket.imagile.dev:7999/PROJ/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+)(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, project, repo] = sshMatch;
    if (host && base.includes(host)) {
      return { project, repo };
    }
  }

  // HTTPS format: https://bitbucket.imagile.dev/scm/PROJ/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/scm\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, project, repo] = httpsMatch;
    if (host && base.includes(host)) {
      return { project, repo };
    }
  }

  return null;
}

/**
 * Parses an Azure DevOps Server git remote URL into { collection, project, repo }.
 *
 * Supported formats:
 *   HTTPS : https://<host>[/<prefix>]/<collection>/<project>/_git/<repo>
 *   SSH   : ssh://git@<host>[:<port>][/<prefix>]/<collection>/<project>/_ssh/<repo>
 *           git@<host>[:<port>]/<prefix>/<collection>/<project>/<repo>
 *
 * Strategy: find the `_git` or `_ssh` segment; walk back — the segment immediately
 * before it is the project, the one before that is the collection. Anything before
 * the collection is treated as a path prefix (e.g. /tfs/) and is ignored.
 * URL is only parsed if the host is contained in adoBaseUrl (same guard as Bitbucket).
 */
export function parseAdoRemote(
  remoteUrl: string,
  adoBaseUrl: string | undefined
): { collection: string; project: string; repo: string } | null {
  if (!adoBaseUrl) return null;

  // Normalize base URL: extract just the hostname (without port) for comparison,
  // so that https://tfs.imagile.dev:8080 and git@tfs.imagile.dev:... both match.
  let baseHostname: string;
  try {
    const normalizedBase = /^https?:\/\//.test(adoBaseUrl) ? adoBaseUrl : `https://${adoBaseUrl}`;
    baseHostname = new URL(normalizedBase).hostname.toLowerCase();
  } catch {
    baseHostname = adoBaseUrl.replace(/\/$/, '').replace(/^https?:\/\//, '').split(/[:/]/)[0]!.toLowerCase();
  }

  // Extract host from the remote URL (after stripping protocol/credentials)
  let path = remoteUrl;
  let remoteHostname = '';

  // ssh:// form
  const sshProtoMatch = path.match(/^ssh:\/\/[^@]*@?([^/:]+)(?::\d+)?(.*)/);
  if (sshProtoMatch) {
    remoteHostname = sshProtoMatch[1]!.toLowerCase();
    path = sshProtoMatch[2]!;
  } else {
    // git@host form or https://
    const gitAtMatch = path.match(/^git@([^:]+)(?::\d+)?:(.*)/);
    if (gitAtMatch) {
      remoteHostname = gitAtMatch[1]!.toLowerCase();
      path = '/' + gitAtMatch[2]!;
    } else {
      const httpsMatch = path.match(/^https?:\/\/([^/:]+)(?::\d+)?(.*)/);
      if (httpsMatch) {
        remoteHostname = httpsMatch[1]!.toLowerCase();
        path = httpsMatch[2]!;
      }
    }
  }

  if (!remoteHostname || remoteHostname !== baseHostname) return null;

  // Strip trailing .git
  path = path.replace(/\.git$/, '');

  // Find _git or _ssh segment
  const gitIdx = path.indexOf('/_git/');
  const sshIdx = path.indexOf('/_ssh/');
  const markerIdx = gitIdx !== -1 ? gitIdx : sshIdx;
  if (markerIdx === -1) return null;

  const repo = decodeURIComponent(path.slice(markerIdx + 6)); // skip /_git/ or /_ssh/
  if (!repo) return null;

  // Everything before the marker: /<prefix>/<collection>/<project>
  const before = path.slice(1, markerIdx); // strip leading /
  const parts = before.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const project = decodeURIComponent(parts[parts.length - 1]!);
  const collection = decodeURIComponent(parts[parts.length - 2]!);

  return { collection, project, repo };
}

/**
 * Parses a GitHub remote URL into { owner, repo }.
 *
 * Supported formats:
 *   HTTPS : https://github.com/{owner}/{repo}[.git]
 *           https://{githubHost}/{owner}/{repo}[.git]
 *   SSH   : git@github.com:{owner}/{repo}[.git]
 *           git@{githubHost}:{owner}/{repo}[.git]
 *           ssh://git@{githubHost}[:port]/{owner}/{repo}[.git]
 *
 * When baseUrl is provided (for GitHub Enterprise), only URLs matching that host are accepted.
 * When baseUrl is undefined, only github.com URLs are matched.
 */
export function parseGitHubRemote(
  remoteUrl: string,
  baseUrl: string | undefined
): { owner: string; repo: string } | null {
  // Determine which host(s) to match
  let targetHost: string;
  if (baseUrl) {
    try {
      const normalizedBase = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
      const hostname = new URL(normalizedBase).hostname.toLowerCase();
      // api.github.com is the REST API host but git remotes use github.com
      targetHost = hostname === 'api.github.com' ? 'github.com' : hostname;
    } catch {
      targetHost = baseUrl.replace(/\/$/, '').replace(/^https?:\/\//i, '').split(/[:/]/)[0]!.toLowerCase();
    }
  } else {
    targetHost = 'github.com';
  }

  // SSH format: git@{host}:{owner}/{repo}[.git]
  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    if (host!.toLowerCase() === targetHost) {
      return { owner: owner!, repo: repo! };
    }
  }

  // ssh:// protocol form: ssh://git@{host}[:port]/{owner}/{repo}[.git]
  const sshProtoMatch = remoteUrl.match(/^ssh:\/\/git@([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshProtoMatch) {
    const [, host, owner, repo] = sshProtoMatch;
    if (host!.toLowerCase() === targetHost) {
      return { owner: owner!, repo: repo! };
    }
  }

  // HTTPS format: https://{host}/{owner}/{repo}[.git]
  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, owner, repo] = httpsMatch;
    if (host!.toLowerCase() === targetHost) {
      return { owner: owner!, repo: repo! };
    }
  }

  return null;
}

function getRemoteUrls(repoRoot: string): string[] {
  try {
    const output = execSync('git remote -v', { encoding: 'utf8', cwd: repoRoot });
    return output
      .split('\n')
      .filter(line => line.includes('(fetch)'))
      .map(line => line.split('\t')[1]?.split(' ')[0] ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getGitContext(config: ResolvedConfig): GitContext | null {
  const root = getRepoRoot();
  if (!root) return null;

  const branch = getCurrentBranch(root) ?? 'unknown';
  const remoteUrls = getRemoteUrls(root);

  // Bitbucket: disambiguated by /scm/ pattern
  let project: string | null = null;
  let repo: string | null = null;
  for (const url of remoteUrls) {
    const parsed = parseRemote(url, config.bitbucket.baseUrl);
    if (parsed) {
      project = parsed.project;
      repo = parsed.repo;
      break;
    }
  }

  // Azure DevOps Server: disambiguated by /_git/ pattern
  let adoContext: GitContext['ado'] = null;
  for (const url of remoteUrls) {
    const parsed = parseAdoRemote(url, config.ado.baseUrl);
    if (parsed) {
      adoContext = parsed;
      break;
    }
  }

  // GitHub: disambiguated by github.com host or configured baseUrl
  let githubContext: GitContext['github'] = null;
  for (const url of remoteUrls) {
    const parsed = parseGitHubRemote(url, config.github.baseUrl);
    if (parsed) {
      githubContext = parsed;
      break;
    }
  }

  return { root, branch, project, repo, ado: adoContext, github: githubContext };
}
