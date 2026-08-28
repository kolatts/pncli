import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { success, fail } from '../../lib/output.js';
import { loadConfig, getGlobalConfigPath, loadJsonFile } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { getPncliVersion } from '../../lib/version.js';
import { runCredentialChecks } from '../config/check.js';
import type { CheckResult } from '../config/check.js';
import { listKnownLocations, findStaleBundledSkills, findGitRoot } from '../skills/commands.js';
import type { StaleSkill } from '../skills/commands.js';
import type { GlobalConfig } from '../../types/config.js';

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
  area: 'config' | 'credentials' | 'skills';
  message: string;
  fix: string;
}

interface SkillLocationReport {
  agent: string;
  scope: string;
  path: string;
  exists: boolean;
  totalSkills: number;
  staleSkills: StaleSkill[];
}

/**
 * Turns the raw section results into an actionable problem list. Exported for
 * tests; the ordering is config → credentials → skills, most-fundamental first.
 */
export function buildProblems(
  globalFile: ConfigFileHealth,
  repoFile: ConfigFileHealth,
  credentials: Record<string, CheckResult> | null,
  skillLocations: SkillLocationReport[]
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

  return problems;
}

export function registerDoctorCommands(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose pncli setup: config files, credentials, and agent skills')
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

        const globalConfig: GlobalConfig = loadJsonFile<GlobalConfig>(getGlobalConfigPath()) ?? {};
        const skillLocations: SkillLocationReport[] = listKnownLocations(globalConfig).map(l => ({
          agent: l.agent,
          scope: l.scope,
          path: l.path,
          exists: l.exists,
          totalSkills: l.totalSkills,
          staleSkills: l.exists ? findStaleBundledSkills(l.path) : [],
        }));

        const problems = buildProblems(globalFile, repoFile, credentials, skillLocations);

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
          problems,
        }, 'doctor', 'check', start);
      } catch (err) {
        fail(err, 'doctor', 'check', start);
      }
    });
}
