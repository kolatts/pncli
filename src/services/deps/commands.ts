import { Command } from 'commander';
import { success, fail } from '../../lib/output.js';
import { loadConfig } from '../../lib/config.js';
import type { ScanOptions, Ecosystem } from './types.js';
import { runScan } from './scan.js';
import { runDiff } from './diff.js';
import { runFrisk } from './frisk.js';
import { runOutdated } from './outdated.js';
import { runLicenseCheck } from './license-check.js';
import { buildConnectivityData } from './connectivity.js';

export function registerDepsCommands(program: Command): void {
  const deps = program
    .command('deps')
    .description('Dependency scanning, CVE detection, and license auditing');

  // ─── frisk (primary) ────────────────────────────────────────────────────────

  deps
    .command('frisk')
    .description('Scan all dependencies for CVEs and output remediation paths (requires OSV.dev)')
    .option('--ecosystem <ecosystem>', 'Filter to one ecosystem: npm, nuget, maven, all', 'all')
    .option('--direct-only', 'Only scan direct dependencies (default: include transitive)', false)
    .option('--include-dev', 'Include dev/test dependencies', false)
    .action(async (opts: { ecosystem: string; directOnly: boolean; includeDev: boolean }, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const scanOpts: ScanOptions = {
          ecosystem: opts.ecosystem as Ecosystem | 'all',
          includeTransitive: !opts.directOnly,
          includeDev: opts.includeDev
        };
        const data = await runFrisk(config, scanOpts);
        success(data, 'deps', 'frisk', startTime);
      } catch (err) {
        fail(err, 'deps', 'frisk', startTime);
      }
    });

  // ─── scan ───────────────────────────────────────────────────────────────────

  deps
    .command('scan')
    .description('Inventory all dependencies from manifest files (local only, no network)')
    .option('--ecosystem <ecosystem>', 'Filter to one ecosystem: npm, nuget, maven, all', 'all')
    .option('--include-transitive', 'Include transitive dependencies', false)
    .option('--include-dev', 'Include dev/test dependencies', false)
    .action((opts: { ecosystem: string; includeTransitive: boolean; includeDev: boolean }, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const scanOpts: ScanOptions = {
          ecosystem: opts.ecosystem as Ecosystem | 'all',
          includeTransitive: opts.includeTransitive,
          includeDev: opts.includeDev
        };
        const data = runScan(config, scanOpts);
        success(data, 'deps', 'scan', startTime);
      } catch (err) {
        fail(err, 'deps', 'scan', startTime);
      }
    });

  // ─── diff ───────────────────────────────────────────────────────────────────

  deps
    .command('diff')
    .description('Show dependency changes between two git refs (local only, no network)')
    .requiredOption('--from <ref>', 'Base git ref (commit, tag, or branch)')
    .option('--to <ref>', 'Target git ref (default: working tree)')
    .option('--ecosystem <ecosystem>', 'Filter to one ecosystem: npm, nuget, maven, all', 'all')
    .option('--include-dev', 'Include dev/test dependencies', false)
    .action((opts: { from: string; to?: string; ecosystem: string; includeDev: boolean }, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const scanOpts: ScanOptions = {
          ecosystem: opts.ecosystem as Ecosystem | 'all',
          includeTransitive: true,
          includeDev: opts.includeDev
        };
        const data = runDiff(config, opts.from, opts.to ?? null, scanOpts);
        success(data, 'deps', 'diff', startTime);
      } catch (err) {
        fail(err, 'deps', 'diff', startTime);
      }
    });

  // ─── outdated ───────────────────────────────────────────────────────────────

  deps
    .command('outdated')
    .description('Check for newer versions available in Artifactory (requires Artifactory)')
    .option('--ecosystem <ecosystem>', 'Filter to one ecosystem: npm, nuget, maven, all', 'all')
    .option('--major', 'Only show major version bumps')
    .option('--minor', 'Only show minor version bumps or higher')
    .option('--patch', 'Only show patch version bumps or higher')
    .action(async (opts: { ecosystem: string; major?: boolean; minor?: boolean; patch?: boolean }, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const scanOpts: ScanOptions = { ecosystem: opts.ecosystem as Ecosystem | 'all' };
        const filterType = opts.major ? 'major' : opts.minor ? 'minor' : opts.patch ? 'patch' : undefined;
        const data = await runOutdated(config, scanOpts, filterType);
        success(data, 'deps', 'outdated', startTime);
      } catch (err) {
        fail(err, 'deps', 'outdated', startTime);
      }
    });

  // ─── license-check ──────────────────────────────────────────────────────────

  deps
    .command('license-check')
    .description('Report licenses for all direct dependencies via Artifactory (requires Artifactory)')
    .option('--ecosystem <ecosystem>', 'Filter to one ecosystem: npm, nuget, maven, all', 'all')
    .option('--include-dev', 'Include dev/test dependencies', false)
    .action(async (opts: { ecosystem: string; includeDev: boolean }, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const scanOpts: ScanOptions = {
          ecosystem: opts.ecosystem as Ecosystem | 'all',
          includeDev: opts.includeDev
        };
        const data = await runLicenseCheck(config, scanOpts);
        success(data, 'deps', 'license-check', startTime);
      } catch (err) {
        fail(err, 'deps', 'license-check', startTime);
      }
    });

  // ─── connectivity ───────────────────────────────────────────────────────────

  deps
    .command('connectivity')
    .description('Test network access to Artifactory and OSV.dev, report available tier')
    .action(async (_opts: unknown, cmd: Command) => {
      const startTime = Date.now();
      try {
        const globalOpts = cmd.optsWithGlobals();
        const config = loadConfig({ configPath: globalOpts.config as string | undefined });
        const data = await buildConnectivityData(config);
        success(data, 'deps', 'connectivity', startTime);
      } catch (err) {
        fail(err, 'deps', 'connectivity', startTime);
      }
    });
}
