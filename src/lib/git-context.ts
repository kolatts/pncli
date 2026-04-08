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

  // SSH format: git@bitbucket.company.com:7999/PROJ/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+)(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, project, repo] = sshMatch;
    if (host && base.includes(host)) {
      return { project, repo };
    }
  }

  // HTTPS format: https://bitbucket.company.com/scm/PROJ/repo.git
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
  // so that https://tfs.company.com:8080 and git@tfs.company.com:... both match.
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

  const repo = path.slice(markerIdx + 6); // skip /_git/ or /_ssh/
  if (!repo) return null;

  // Everything before the marker: /<prefix>/<collection>/<project>
  const before = path.slice(1, markerIdx); // strip leading /
  const parts = before.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const project = parts[parts.length - 1]!;
  const collection = parts[parts.length - 2]!;

  return { collection, project, repo };
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

  return { root, branch, project, repo, ado: adoContext };
}
