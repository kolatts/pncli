import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { success, fail } from '../../lib/output.js';
import { ExitCode } from '../../lib/exitCodes.js';
import { loadConfig, getGlobalConfigPath, loadJsonFile } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { getPncliVersion } from '../../lib/version.js';
import { runCredentialChecks } from '../config/check.js';
import type { CheckResult } from '../config/check.js';
import { listKnownLocations, findStaleBundledSkills, findGitRoot, getAllMarketplaces } from '../skills/commands.js';
import type { StaleSkill } from '../skills/commands.js';
import type { GlobalConfig } from '../../types/config.js';
import { checkKeychain, checkGitAuth, buildKeychainProblems, buildGitAuthProblems } from './git-auth-checks.js';
import type { GitAuthDoctorReport } from './git-auth-checks.js';

export interface ConfigFileHealth {
  path: string;
  exists: boolean;
  valid: boolean;
  message: string;
}

/**
 * Reports whether a config file exists and parses as JSON, without loading it
 * through the normal config pipeline — doctor must be able to describe a
 * corrupt file rather than crash on it.
 */
export function checkConfigFile(filePath: string): ConfigFileHealth {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, valid: false, message: 'not present' };
  }
  try {
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { path: filePath, exists: true, valid: true, message: 'ok' };
  } catch (err) {
    return {
      path: filePath,
      exists: true,
      valid: false,
      message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface DoctorProblem {
  area: 'config' | 'credentials' | 'skills' | 'marketplaces' | 'keychain' | 'git-auth';
  message: string;
  fix: string;
}

interface SkillLocationReport {
  agent: string;
  scope: string;
  path: string;
  exists: boolean;
  totalSkills: number;
  marketplaceSkills?: number;
  staleSkills: StaleSkill[];
}

export interface MarketplaceReport {
  name: string;
  repoUrl: string | null;
  localPath: string | null;
  /** False when the registered clone directory is gone — sync will fail until it is re-added. */
  cloneExists: boolean;
}

/**
 * Turns the raw section results into an actionable problem list. Exported for
 * tests; the ordering is config → credentials → skills, most-fundamental first.
 */
export function buildProblems(
  globalFile: ConfigFileHealth,
  repoFile: ConfigFileHealth,
  credentials: Record<string, CheckResult> | null,
  skillLocations: SkillLocationReport[],
  marketplaces: MarketplaceReport[] = []
): DoctorProblem[] {
  const problems: DoctorProblem[] = [];

  for (const file of [globalFile, repoFile]) {
    if (file.exists && !file.valid) {
      problems.push({
        area: 'config',
        message: `${file.path} is not valid JSON (${file.message})`,
        fix: 'Fix the JSON by hand, or delete the file and re-run: pncli config init',
      });
    }
  }
  if (!globalFile.exists) {
    problems.push({
      area: 'config',
      message: 'No global config found',
      fix: 'Run: pncli config init (or set PNCLI_* environment variables)',
    });
  }

  if (credentials) {
    for (const [service, result] of Object.entries(credentials)) {
      if (result.status === 'invalid') {
        problems.push({
          area: 'credentials',
          message: `${service}: ${result.message}`,
          fix: `Regenerate the token in ${service} and update it via pncli config set (or the PNCLI_* env var)`,
        });
      } else if (result.status === 'error') {
        problems.push({
          area: 'credentials',
          message: `${service}: ${result.message}`,
          fix: 'Check the baseUrl and network reachability, then re-run: pncli config test',
        });
      }
    }
  }

  const existing = skillLocations.filter(l => l.exists);
  if (existing.every(l => l.totalSkills === 0)) {
    problems.push({
      area: 'skills',
      message: 'No agent skills installed in any known location',
      fix: 'Run: pncli skills install (add --all-agents to cover every agent host)',
    });
  }
  const staleTotal = skillLocations.reduce((sum, l) => sum + l.staleSkills.length, 0);
  if (staleTotal > 0) {
    problems.push({
      area: 'skills',
      message: `${staleTotal} bundled skill(s) were installed by a different pncli version`,
      fix: 'Refresh them with: pncli skills install',
    });
  }

  // Marketplace advisories: a registered marketplace that nothing was ever installed from is
  // the most common "I ran add but my agent can't see the plugin" report.
  for (const m of marketplaces.filter(m => !m.cloneExists)) {
    problems.push({
      area: 'marketplaces',
      message: `Marketplace "${m.name}" is registered but its clone is missing (${m.localPath ?? 'no local path'})`,
      fix: `Re-clone it with: pncli skills marketplace add ${m.repoUrl ?? '<url>'}`,
    });
  }
  const marketplaceSkillTotal = skillLocations.reduce((sum, l) => sum + (l.marketplaceSkills ?? 0), 0);
  const liveMarketplaces = marketplaces.filter(m => m.cloneExists).length;
  if (liveMarketplaces > 0 && marketplaceSkillTotal === 0) {
    problems.push({
      area: 'marketplaces',
      message: `${liveMarketplaces} marketplace(s) registered but no plugin skills are installed from any of them`,
      fix: 'Run: pncli skills marketplace sync --marketplace all --all-agents',
    });
  }

  return problems;
}

export function registerDoctorCommands(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose pncli setup: config files, credentials, keychain references, git auth for marketplace hosts, agent skills, and marketplaces')
    .option('--offline', 'Skip credential checks (no network calls)')
    .action(async (cmdOpts: { offline?: boolean }) => {
      const start = Date.now();
      try {
        const opts = program.optsWithGlobals();

        const globalFile = checkConfigFile(opts.config ?? getGlobalConfigPath());
        const repoRoot = findGitRoot() ?? process.cwd();
        const repoFile = checkConfigFile(path.join(repoRoot, '.pncli.json'));

        // Credential checks reuse the exact logic behind `config check`.
        // loadConfig can throw on a malformed file; the file health above
        // already explains why, so degrade to "skipped" instead of failing.
        let credentials: Record<string, CheckResult> | null = null;
        let credentialsSkipped: string | null = cmdOpts.offline ? '--offline' : null;
        if (!cmdOpts.offline) {
          try {
            const cfg = loadConfig({ configPath: opts.config });
            credentials = await runCredentialChecks(cfg, createHttpClient(cfg, false));
          } catch (err) {
            credentialsSkipped = `config could not be loaded: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(opts.config ?? getGlobalConfigPath()) ?? {};
        const skillLocations: SkillLocationReport[] = listKnownLocations(globalConfig).map(l => ({
          agent: l.agent,
          scope: l.scope,
          path: l.path,
          exists: l.exists,
          totalSkills: l.totalSkills,
          marketplaceSkills: l.marketplaceSkills,
          staleSkills: l.exists ? findStaleBundledSkills(l.path) : [],
        }));
        const marketplaces: MarketplaceReport[] = getAllMarketplaces(globalConfig).map(m => ({
          name: m.name ?? m.repoUrl ?? '(unnamed)',
          repoUrl: m.repoUrl ?? null,
          localPath: m.localPath ?? null,
          cloneExists: !!m.localPath && fs.existsSync(m.localPath),
        }));

        // Keychain and git-auth are local checks (the token inspection is skipped under --offline).
        // Either failing to run must degrade to a note, never take the whole report down.
        const keychain = (() => {
          try { return checkKeychain(globalConfig, undefined, opts.config ?? getGlobalConfigPath()); } catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
        })();
        let gitAuth: GitAuthDoctorReport[] | { error: string } = [];
        try {
          const providerCfg = (() => { try { return loadConfig({ configPath: opts.config }); } catch { return {}; } })();
          gitAuth = await checkGitAuth(globalConfig, providerCfg, !!cmdOpts.offline);
        } catch (err) {
          gitAuth = { error: err instanceof Error ? err.message : String(err) };
        }

        const problems = [
          ...buildProblems(globalFile, repoFile, credentials, skillLocations, marketplaces),
          ...('error' in keychain ? [] : buildKeychainProblems(keychain)),
          ...(Array.isArray(gitAuth) ? buildGitAuthProblems(gitAuth) : []),
        ];

        // Mirror `config check` exit semantics so CI can gate on doctor directly:
        // invalid credentials → AUTH_ERROR, other credential failures → NETWORK_ERROR.
        // Config/skills advisories stay exit 0 — they are guidance, not failures.
        if (credentials) {
          const statuses = Object.values(credentials).map(r => r.status);
          if (statuses.includes('invalid')) process.exitCode = ExitCode.AUTH_ERROR;
          else if (statuses.includes('error')) process.exitCode = ExitCode.NETWORK_ERROR;
        }

        success({
          healthy: problems.length === 0,
          version: {
            pncli: getPncliVersion(),
            node: process.version,
            platform: process.platform,
          },
          config: { global: globalFile, repo: repoFile },
          credentials: credentials ?? { skipped: credentialsSkipped },
          skills: {
            locations: skillLocations,
            staleTotal: skillLocations.reduce((sum, l) => sum + l.staleSkills.length, 0),
          },
          marketplaces: {
            registered: marketplaces,
            hint: marketplaces.length === 0
              ? 'No org marketplaces registered. Add one with: pncli skills marketplace add <git-url> --all-agents'
              : 'Refresh with: pncli skills marketplace sync --marketplace all --all-agents',
          },
          keychain,
          gitAuth,
          problems,
          hint: problems.length === 0 ? null : 'New to skills and marketplaces? pncli skills guide troubleshooting',
        }, 'doctor', 'check', start);
      } catch (err) {
        fail(err, 'doctor', 'check', start);
      }
    });
}
