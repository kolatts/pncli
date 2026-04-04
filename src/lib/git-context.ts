import { execSync } from 'child_process';
import type { ResolvedConfig } from '../types/config.js';

export interface GitContext {
  root: string;
  branch: string;
  project: string | null;
  repo: string | null;
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

  return { root, branch, project, repo };
}
