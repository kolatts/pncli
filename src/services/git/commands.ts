import { Command } from 'commander';
import { getStatus, getDiff, getLog, getBranches, getBranchReport, formatBranchReportCsv } from './client.js';
import { getRepoRoot, getCurrentBranch } from '../../lib/git-context.js';
import { success, fail, writeRawOutput } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { BitbucketClient } from '../bitbucket/client.js';
import { getGitContext } from '../../lib/git-context.js';
import { inspectRemoteAuth, listRemotes, findClones, listMappings, listStoredCredentials, forgetCredential } from './credentials.js';
import type { RemoteAuthReport } from './credentials.js';
import type { TokenInspection } from '../skills/git-auth.js';
import { gitHostFromApiBaseUrl, hostOf } from '../skills/git-auth.js';
import fs from 'fs';
import path from 'path';

function requireRepoRoot(): string {
  const root = getRepoRoot();
  if (!root) throw new PncliError('Not a git repository', 1);
  return root;
}

export function registerGitCommands(program: Command): void {
  const git = program.command('git').description('Local git operations');

  git
    .command('status')
    .description('Show staged, unstaged, and untracked files as JSON')
    .action(() => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getStatus(root);
        success(data, 'git', 'status', start);
      } catch (err) {
        fail(err, 'git', 'status', start);
      }
    });

  git
    .command('diff')
    .description('Show diff as structured JSON')
    .option('--staged', 'Show staged changes only')
    .option('--file <path>', 'Limit diff to a specific file')
    .action((opts: { staged?: boolean; file?: string }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getDiff(root, { staged: opts.staged, file: opts.file });
        success(data, 'git', 'diff', start);
      } catch (err) {
        fail(err, 'git', 'diff', start);
      }
    });

  git
    .command('log')
    .description('Show recent commits as JSON')
    .option('--count <n>', 'Number of commits to show', '10')
    .option('--since <date>', 'Show commits since date (e.g. "2 weeks ago")')
    .action((opts: { count?: string; since?: string }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const count = opts.count ? parseInt(opts.count, 10) : undefined;
        const data = getLog(root, { count, since: opts.since });
        success(data, 'git', 'log', start);
      } catch (err) {
        fail(err, 'git', 'log', start);
      }
    });

  git
    .command('branch')
    .description('Show current branch and all local/remote branches')
    .action(() => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const data = getBranches(root);
        success(data, 'git', 'branch', start);
      } catch (err) {
        fail(err, 'git', 'branch', start);
      }
    });

  git
    .command('report')
    .description('Report lines of code and commit counts for a branch, optionally filtered by date')
    .option('--branch <name>', 'Branch to report on (defaults to current branch)')
    .option('--base <ref>', 'Base ref to compare against, e.g. "main" (base..branch, or base..HEAD if --branch is omitted)')
    .option('--since <date>', 'Include commits on or after this date (e.g. "2024-01-01")')
    .option('--until <date>', 'Include commits on or before this date (e.g. "2024-12-31")')
    .option('--csv', 'Output as CSV instead of JSON')
    .action((opts: { branch?: string; base?: string; since?: string; until?: string; csv?: boolean }) => {
      const start = Date.now();
      try {
        const root = requireRepoRoot();
        const report = getBranchReport(root, {
          branch: opts.branch,
          base: opts.base,
          since: opts.since,
          until: opts.until
        });
        if (opts.csv) {
          writeRawOutput(formatBranchReportCsv(report));
        } else {
          success(report, 'git', 'report', start);
        }
      } catch (err) {
        fail(err, 'git', 'report', start);
      }
    });

  git
    .command('current-pr')
    .description('Find the open PR for the current branch')
    .action(async () => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const config = loadConfig({ configPath: opts.config });

        if (!config.bitbucket.baseUrl || !config.bitbucket.pat) {
          success(
            { message: 'Requires Bitbucket config. Available after pncli config init.' },
            'git',
            'current-pr',
            start
          );
          return;
        }

        const root = requireRepoRoot();
        const branch = getCurrentBranch(root);
        if (!branch) throw new PncliError('Could not determine current branch', 1);

        const ctx = getGitContext(config);
        const project = ctx?.project ?? config.defaults.bitbucket?.project ?? '';
        const repo = ctx?.repo ?? config.defaults.bitbucket?.repo ?? '';
        if (!project || !repo) throw new PncliError('Could not determine Bitbucket project/repo', 1);

        const http = createHttpClient(config, Boolean(opts.dryRun));
        const client = new BitbucketClient(http);
        const prs = await client.listPRs({ project, repo, state: 'OPEN' });
        const match = prs.find(pr => pr.fromRef.displayId === branch) ?? null;
        success(match, 'git', 'current-pr', start);
      } catch (err) {
        fail(err, 'git', 'current-pr', start);
      }
    });

  const credentials = git
    .command('credentials')
    .description('Inspect which credential git uses for the remotes of a clone (insteadOf mappings, embedded tokens, helpers) and whether it can read the repo');
  credentials.addHelpText('after', `
Read-only except forget. Tokens are never printed — only their type and a fingerprint (ghp_…a1b2).

Examples:
  pncli git credentials inspect                       # every remote of the clone you are in
  pncli git credentials inspect ~/src/tools --remote upstream
  pncli git credentials inspect https://github.com/imagile/tools.git
  pncli git credentials inspect --scan ~/src --problems-only   # clones mapped without a token, or without access
  pncli git credentials mappings                      # every insteadOf rewrite and URL-scoped helper, tokens checked
  pncli git credentials stored                        # Git Credential Manager / Windows Credential Manager /
                                                      # Keychain / ~/.git-credentials: accounts, token health
  pncli git credentials forget --host github.com --username octo   # drop a stale stored credential
`);

  credentials
    .command('inspect')
    .description('Show the credential each remote uses after insteadOf rewriting, and (online) whether it can read the repo')
    .argument('[target]', 'A clone directory or a remote URL (default: the current clone)')
    .option('--remote <name>', 'Only this remote (default: all remotes)')
    .option('--scan <dir>', 'Inspect every clone under this directory instead')
    .option('--depth <n>', 'How many directory levels --scan descends', '2')
    .option('--problems-only', 'With --scan, only list remotes that have problems')
    .option('--offline', 'Skip network checks (ls-remote and the GitHub API)')
    .action(async (target: string | undefined, cmdOpts: { remote?: string; scan?: string; depth: string; problemsOnly?: boolean; offline?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const cfg = (() => { try { return loadConfig({ configPath: opts.config }); } catch { return {}; } })();
        const cache = new Map<string, TokenInspection>();
        const deps = { offline: !!cmdOpts.offline, cache };

        const inspectClone = async (dir: string): Promise<RemoteAuthReport[]> => {
          const remotes = listRemotes(dir).filter(([name]) => !cmdOpts.remote || name === cmdOpts.remote);
          const out: RemoteAuthReport[] = [];
          for (const [name, url] of remotes) out.push(await inspectRemoteAuth(name, url, dir, cfg, deps));
          return out;
        };

        if (cmdOpts.scan) {
          const depth = Number.parseInt(cmdOpts.depth, 10);
          if (!Number.isInteger(depth) || depth < 0) throw new PncliError('--depth must be a non-negative integer', 1);
          const clones = findClones(cmdOpts.scan, depth);
          const results = [];
          for (const dir of clones) {
            const remotes = await inspectClone(dir);
            const shown = cmdOpts.problemsOnly ? remotes.filter(r => r.problems.length > 0) : remotes;
            if (shown.length > 0) results.push({ path: dir, remotes: shown });
          }
          const all = results.flatMap(r => r.remotes);
          success({
            root: path.resolve(cmdOpts.scan),
            clonesScanned: clones.length,
            summary: {
              remotes: all.length,
              withProblems: all.filter(r => r.problems.length > 0).length,
              noCredential: all.filter(r => r.host && r.credentialSource === 'none').length,
              cannotRead: all.filter(r => r.access && !r.access.ok).length,
            },
            clones: results,
          }, 'git', 'credentials-inspect', start);
          return;
        }

        if (target && /^(https?:\/\/|git@|ssh:\/\/)/i.test(target)) {
          success({ remotes: [await inspectRemoteAuth(null, target, null, cfg, deps)] }, 'git', 'credentials-inspect', start);
          return;
        }
        const dir = target ? path.resolve(target) : requireRepoRoot();
        if (!fs.existsSync(path.join(dir, '.git'))) throw new PncliError(`${dir} is not a git clone`, 1);
        const remotes = await inspectClone(dir);
        if (remotes.length === 0) throw new PncliError(cmdOpts.remote ? `No remote named "${cmdOpts.remote}" in ${dir}` : `${dir} has no remotes`, 1);
        success({ path: dir, remotes }, 'git', 'credentials-inspect', start);
      } catch (err) {
        fail(err, 'git', 'credentials-inspect', start);
      }
    });

  credentials
    .command('mappings')
    .description('List every insteadOf URL rewrite and URL-scoped credential helper in your gitconfig, tokens redacted and (online) validated')
    .option('--offline', 'Skip validating embedded GitHub tokens')
    .action(async (cmdOpts: { offline?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const cfg = (() => { try { return loadConfig({ configPath: opts.config }); } catch { return {}; } })();
        const mappings = await listMappings(getRepoRoot(), cfg, { offline: !!cmdOpts.offline });
        success({ mappings, total: mappings.length }, 'git', 'credentials-mappings', start);
      } catch (err) {
        fail(err, 'git', 'credentials-mappings', start);
      }
    });

  credentials
    .command('stored')
    .description('List credentials git keeps in Git Credential Manager, Windows Credential Manager, the macOS Keychain, or ~/.git-credentials, with what git would send per host and (online) token health')
    .option('--host <host...>', 'Also ask git what it would send for these hosts')
    .option('--offline', 'Skip validating GitHub tokens')
    .action(async (cmdOpts: { host?: string[]; offline?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();
        const cfg = (() => { try { return loadConfig({ configPath: opts.config }); } catch { return {}; } })() as Parameters<typeof listStoredCredentials>[1] & { bitbucket?: { baseUrl?: string }; ado?: { baseUrl?: string } };
        // Hosts worth probing: the ones asked for, the configured service hosts, and the current clone's remotes.
        const hosts = new Set<string>((cmdOpts.host ?? []).map(h => h.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')));
        for (const h of [gitHostFromApiBaseUrl(cfg.github?.baseUrl), hostOf(cfg.bitbucket?.baseUrl), hostOf(cfg.ado?.baseUrl)]) if (h) hosts.add(h);
        const root = getRepoRoot();
        if (root) for (const [, url] of listRemotes(root)) { const h = hostOf(url); if (h) hosts.add(h); }
        const report = await listStoredCredentials([...hosts], cfg, { offline: !!cmdOpts.offline });
        success(report, 'git', 'credentials-stored', start);
      } catch (err) {
        fail(err, 'git', 'credentials-stored', start);
      }
    });

  credentials
    .command('forget')
    .description('Remove a stored credential for a host through git credential reject (works for every helper: Git Credential Manager, wincred, osxkeychain, libsecret, store)')
    .requiredOption('--host <host>', 'Host to forget, e.g. github.com')
    .option('--username <username>', 'Only this account (when several are stored for the host)')
    .option('--path <path>', 'Repository path, for helpers that store per repository (e.g. Azure Repos in Git Credential Manager)')
    .action((cmdOpts: { host: string; username?: string; path?: string }) => {
      const start = Date.now();
      try {
        const host = cmdOpts.host.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const result = forgetCredential(host, { username: cmdOpts.username, path: cmdOpts.path });
        if (!result.before) throw new PncliError(`git has no stored credential for ${host}${cmdOpts.path ? `/${cmdOpts.path}` : ''} — nothing to forget`, 1);
        success({
          ...result,
          next: result.removed
            ? 'git will ask for (or its helper will fetch) a fresh credential next time'
            : 'git still supplies the same credential — it may come from an insteadOf mapping or a helper that ignores reject; see: pncli git credentials inspect',
        }, 'git', 'credentials-forget', start);
      } catch (err) {
        fail(err, 'git', 'credentials-forget', start);
      }
    });
}
