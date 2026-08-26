import fs from 'fs';
import { Command } from 'commander';
import confirm from '@inquirer/confirm';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient, type HttpClient } from '../../lib/http.js';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

// ── API shape stubs ──────────────────────────────────────────────────────────

interface SplitWorkspace {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface SplitEnvironment {
  id: string;
  name: string;
  production: boolean;
  [key: string]: unknown;
}

interface SplitFlag {
  name: string;
  description?: string;
  trafficType?: { name: string };
  tags?: string[];
  [key: string]: unknown;
}

interface SplitFlagDefinition {
  name: string;
  environment?: { name: string };
  killed?: boolean;
  treatments?: unknown[];
  defaultRule?: unknown[];
  rules?: unknown[];
  trafficAllocation?: number;
  [key: string]: unknown;
}

interface ChangeRequest {
  id: string;
  title: string;
  status: string;
  operationType: string;
  [key: string]: unknown;
}

interface PagedResponse<T> {
  objects: T[];
  offset?: number;
  limit?: number;
  totalCount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHttp(program: Command): HttpClient {
  const opts = program.optsWithGlobals();
  return createHttpClient(
    loadConfig({ configPath: opts.config as string | undefined }),
    Boolean(opts.dryRun)
  );
}

function loadInputFile(filePath: string): unknown {
  let raw: string;
  if (filePath === '-') {
    raw = fs.readFileSync(process.stdin.fd, 'utf8');
  } else {
    raw = fs.readFileSync(filePath, 'utf8');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new PncliError(`Could not parse JSON from ${filePath === '-' ? 'stdin' : filePath}`);
  }
}

interface CrSharedOpts {
  mnemonic: string;
  description: string;
  changeNumber: string;
  approvers?: string;
  yes?: boolean;
}

async function confirmWrite(opts: CrSharedOpts, opLabel: string): Promise<void> {
  if (opts.yes) return;
  const proceed = await confirm({
    message: `Submit Change Request "${opts.mnemonic}" (${opLabel})? This creates an approval request in Split.`,
    default: false
  });
  if (!proceed) throw new PncliError('Aborted by user.', 0);
}

function buildCrBase(opts: CrSharedOpts): Record<string, unknown> {
  const base: Record<string, unknown> = {
    title: opts.mnemonic,
    comment: opts.description,
    crNumber: opts.changeNumber
  };
  if (opts.approvers) {
    base['approvers'] = opts.approvers.split(',').map(s => s.trim()).filter(Boolean).map(id => ({ id }));
  }
  return base;
}

// ── Command registration ─────────────────────────────────────────────────────

export function registerSplitioCommands(program: Command): void {
  const splitio = program.command('splitio').description('Split.IO feature flag administration');

  // ── Workspaces ─────────────────────────────────────────────────────────────
  const workspaces = splitio.command('workspaces').description('Workspace operations');

  workspaces
    .command('list')
    .description('List all Split.IO workspaces')
    .action(async () => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const data = await http.splitio<PagedResponse<SplitWorkspace>>('/internal/api/v2/workspaces');
        success(
          { count: data.objects.length, workspaces: data.objects },
          'splitio', 'workspaces list', start
        );
      } catch (err) { fail(err, 'splitio', 'workspaces list', start); }
    });

  // ── Environments ───────────────────────────────────────────────────────────
  const environments = splitio.command('environments').description('Environment operations');

  environments
    .command('list')
    .description('List environments in a workspace')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .action(async (opts: { workspace: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const data = await http.splitio<PagedResponse<SplitEnvironment>>(
          `/internal/api/v2/workspaces/${encodeURIComponent(opts.workspace)}/environments`
        );
        success(
          { count: data.objects.length, environments: data.objects },
          'splitio', 'environments list', start
        );
      } catch (err) { fail(err, 'splitio', 'environments list', start); }
    });

  // ── Flags ──────────────────────────────────────────────────────────────────
  const flags = splitio.command('flags').description('Feature flag operations');

  flags
    .command('list')
    .description('List feature flags in a workspace')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--limit <n>', 'Maximum number of flags to return', '50')
    .option('--offset <n>', 'Pagination offset', '0')
    .option('--flag-set <name>', 'Filter by flag set name')
    .action(async (opts: { workspace: string; limit: string; offset: string; flagSet?: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const params: Record<string, string | number | boolean | undefined> = {
          wsId: opts.workspace,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10)
        };
        if (opts.flagSet) params['flagSetName'] = opts.flagSet;
        const data = await http.splitio<PagedResponse<SplitFlag>>('/internal/api/v2/splits', { params });
        success(
          { count: data.objects.length, totalCount: data.totalCount, flags: data.objects },
          'splitio', 'flags list', start
        );
      } catch (err) { fail(err, 'splitio', 'flags list', start); }
    });

  flags
    .command('get')
    .description('Get a flag definition')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .option('--environment <id>', 'Environment ID — include targeting rules for this environment')
    .action(async (opts: { workspace: string; flag: string; environment?: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        if (opts.environment) {
          const data = await http.splitio<SplitFlagDefinition>(
            `/internal/api/v2/splits/${encodeURIComponent(opts.flag)}/environments/${encodeURIComponent(opts.environment)}`,
            { params: { wsId: opts.workspace } }
          );
          success(data, 'splitio', 'flags get', start);
        } else {
          const data = await http.splitio<SplitFlag>(
            `/internal/api/v2/splits/${encodeURIComponent(opts.flag)}`,
            { params: { wsId: opts.workspace } }
          );
          success(data, 'splitio', 'flags get', start);
        }
      } catch (err) { fail(err, 'splitio', 'flags get', start); }
    });

  flags
    .command('update')
    .description('Submit a Change Request to replace a flag\'s full definition in an environment')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--input-file <path>', 'JSON file with the complete flag definition body (use - for stdin)')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & {
      workspace: string; flag: string; environment: string; inputFile?: string;
    }) => {
      const start = Date.now();
      try {
        if (!opts.inputFile) throw new PncliError('--input-file is required for flags update');
        const definition = loadInputFile(opts.inputFile);
        await confirmWrite(opts, `UPDATE ${opts.flag} in ${opts.environment}`);

        const http = getHttp(program);
        const body = {
          ...buildCrBase(opts),
          operationType: 'UPDATE_SPLIT_DEFINITION',
          split: {
            name: opts.flag,
            environment: { id: opts.environment },
            definition
          },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags update', start);
      } catch (err) { fail(err, 'splitio', 'flags update', start); }
    });

  flags
    .command('set-rule')
    .description('Change one targeting rule without altering the rest of the flag definition')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--rule-index <n>', 'Zero-based index of the targeting rule to update')
    .option('--treatment <name>', 'Treatment to assign to the entire rule bucket')
    .option('--weights <json>', 'JSON array of {treatment, size} objects for weighted distribution')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & {
      workspace: string; flag: string; environment: string;
      ruleIndex: string; treatment?: string; weights?: string;
    }) => {
      const start = Date.now();
      try {
        if (!opts.treatment && !opts.weights) {
          throw new PncliError('Either --treatment or --weights must be specified');
        }
        const http = getHttp(program);

        // Fetch current definition to patch in-place
        const current = await http.splitio<SplitFlagDefinition>(
          `/internal/api/v2/splits/${encodeURIComponent(opts.flag)}/environments/${encodeURIComponent(opts.environment)}`,
          { params: { wsId: opts.workspace } }
        );

        const rules = (current.rules ?? []) as Array<Record<string, unknown>>;
        const idx = parseInt(opts.ruleIndex, 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= rules.length) {
          throw new PncliError(`Rule index ${Number.isNaN(idx) ? JSON.stringify(opts.ruleIndex) : idx} is out of range (flag has ${rules.length} rules)`);
        }

        if (opts.treatment) {
          rules[idx] = { ...rules[idx], buckets: [{ treatment: opts.treatment, size: 100000 }] };
        } else {
          const parsed = JSON.parse(opts.weights!) as Array<{ treatment: string; size: number }>;
          rules[idx] = { ...rules[idx], buckets: parsed };
        }

        await confirmWrite(opts, `SET_RULE ${idx} on ${opts.flag} in ${opts.environment}`);

        const body = {
          ...buildCrBase(opts),
          operationType: 'UPDATE_SPLIT_DEFINITION',
          split: {
            name: opts.flag,
            environment: { id: opts.environment },
            definition: { ...current, rules }
          },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags set-rule', start);
      } catch (err) { fail(err, 'splitio', 'flags set-rule', start); }
    });

  flags
    .command('set-default')
    .description('Update the fallback default rule for traffic matching no targeting rule')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--treatment <name>', 'Treatment to assign as the default')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & {
      workspace: string; flag: string; environment: string; treatment: string;
    }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);

        // Fetch current definition so we only change defaultRule
        const current = await http.splitio<SplitFlagDefinition>(
          `/internal/api/v2/splits/${encodeURIComponent(opts.flag)}/environments/${encodeURIComponent(opts.environment)}`,
          { params: { wsId: opts.workspace } }
        );

        await confirmWrite(opts, `SET_DEFAULT ${opts.treatment} on ${opts.flag} in ${opts.environment}`);

        const body = {
          ...buildCrBase(opts),
          operationType: 'UPDATE_SPLIT_DEFINITION',
          split: {
            name: opts.flag,
            environment: { id: opts.environment },
            definition: {
              ...current,
              defaultRule: [{ treatment: opts.treatment, size: 100000 }]
            }
          },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags set-default', start);
      } catch (err) { fail(err, 'splitio', 'flags set-default', start); }
    });

  flags
    .command('toggle')
    .description('Enable or disable a single flag via a Change Request')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--enabled <bool>', 'true to restore / false to kill the flag')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & {
      workspace: string; flag: string; environment: string; enabled: string;
    }) => {
      const start = Date.now();
      try {
        const enable = opts.enabled.toLowerCase() !== 'false' && opts.enabled !== '0';
        const opType = enable ? 'RESTORE_SPLIT' : 'KILL_SPLIT';
        await confirmWrite(opts, `${opType} ${opts.flag} in ${opts.environment}`);

        const http = getHttp(program);
        const body = {
          ...buildCrBase(opts),
          operationType: opType,
          split: { name: opts.flag, environment: { id: opts.environment } },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags toggle', start);
      } catch (err) { fail(err, 'splitio', 'flags toggle', start); }
    });

  flags
    .command('batch-toggle')
    .description('Enable or disable multiple flags from a JSON file (each creates its own Change Request)')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--mnemonic <text>', 'Short Change Request title prefix (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve each CR')
    .option('--input-file <path>', 'JSON file: array of {flag, enabled} objects (use - for stdin)')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & {
      workspace: string; environment: string; inputFile?: string;
    }) => {
      const start = Date.now();
      try {
        if (!opts.inputFile) throw new PncliError('--input-file is required for batch-toggle');
        const entries = loadInputFile(opts.inputFile) as Array<{ flag: string; enabled: boolean }>;
        if (!Array.isArray(entries)) throw new PncliError('Input file must be a JSON array of {flag, enabled} objects');

        await confirmWrite(opts, `BATCH_TOGGLE ${entries.length} flags in ${opts.environment}`);

        const http = getHttp(program);
        const results: Array<{ flag: string; ok: boolean; id?: string; error?: string }> = [];

        for (const entry of entries) {
          try {
            const opType = entry.enabled ? 'RESTORE_SPLIT' : 'KILL_SPLIT';
            const body = {
              ...buildCrBase(opts),
              title: `${opts.mnemonic} — ${entry.flag}`,
              operationType: opType,
              split: { name: entry.flag, environment: { id: opts.environment } },
              workspace: { id: opts.workspace }
            };
            const cr = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
              method: 'POST',
              body
            });
            results.push({ flag: entry.flag, ok: true, id: cr.id });
          } catch (err) {
            results.push({
              flag: entry.flag,
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }

        success({ submitted: results.length, results }, 'splitio', 'flags batch-toggle', start);
      } catch (err) { fail(err, 'splitio', 'flags batch-toggle', start); }
    });

  flags
    .command('kill')
    .description('Submit a Change Request to kill (disable) a flag')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & { workspace: string; flag: string; environment: string }) => {
      const start = Date.now();
      try {
        await confirmWrite(opts, `KILL ${opts.flag} in ${opts.environment}`);
        const http = getHttp(program);
        const body = {
          ...buildCrBase(opts),
          operationType: 'KILL_SPLIT',
          split: { name: opts.flag, environment: { id: opts.environment } },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags kill', start);
      } catch (err) { fail(err, 'splitio', 'flags kill', start); }
    });

  flags
    .command('restore')
    .description('Submit a Change Request to restore a killed flag')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--environment <id>', 'Environment ID')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--approvers <ids>', 'Comma-separated Split user IDs required to approve this CR')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & { workspace: string; flag: string; environment: string }) => {
      const start = Date.now();
      try {
        await confirmWrite(opts, `RESTORE ${opts.flag} in ${opts.environment}`);
        const http = getHttp(program);
        const body = {
          ...buildCrBase(opts),
          operationType: 'RESTORE_SPLIT',
          split: { name: opts.flag, environment: { id: opts.environment } },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags restore', start);
      } catch (err) { fail(err, 'splitio', 'flags restore', start); }
    });

  flags
    .command('archive')
    .description('Submit a Change Request to archive (delete definition of) a flag')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .requiredOption('--flag <name>', 'Feature flag name')
    .requiredOption('--mnemonic <text>', 'Short Change Request title (mnemonic)')
    .requiredOption('--description <text>', 'Change Request description')
    .requiredOption('--change-number <CHG>', 'ServiceNow change request number (e.g. CHG0001234)')
    .option('--yes', 'Skip interactive confirmation prompt')
    .action(async (opts: CrSharedOpts & { workspace: string; flag: string }) => {
      const start = Date.now();
      try {
        await confirmWrite(opts, `ARCHIVE ${opts.flag}`);
        const http = getHttp(program);
        const body = {
          ...buildCrBase(opts),
          operationType: 'ARCHIVE_SPLIT',
          split: { name: opts.flag },
          workspace: { id: opts.workspace }
        };
        const data = await http.splitio<ChangeRequest>('/internal/api/v2/changeRequests', {
          method: 'POST',
          body
        });
        success(data, 'splitio', 'flags archive', start);
      } catch (err) { fail(err, 'splitio', 'flags archive', start); }
    });

  // ── Change Requests ────────────────────────────────────────────────────────
  const changeRequests = splitio.command('change-requests').description('Change Request tracking');

  changeRequests
    .command('list')
    .description('List Change Requests for a workspace')
    .requiredOption('--workspace <id>', 'Workspace ID')
    .option('--environment <id>', 'Filter by environment ID')
    .option('--status <status>', 'Filter by status (REQUESTED, APPROVED, REJECTED, PUBLISHED)')
    .option('--limit <n>', 'Maximum number of results', '25')
    .option('--offset <n>', 'Pagination offset', '0')
    .action(async (opts: {
      workspace: string; environment?: string; status?: string; limit: string; offset: string;
    }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const params: Record<string, string | number | boolean | undefined> = {
          wsId: opts.workspace,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10)
        };
        if (opts.environment) params['environmentId'] = opts.environment;
        if (opts.status) params['status'] = opts.status;
        const data = await http.splitio<PagedResponse<ChangeRequest>>(
          '/internal/api/v2/changeRequests',
          { params }
        );
        success(
          { count: data.objects.length, totalCount: data.totalCount, changeRequests: data.objects },
          'splitio', 'change-requests list', start
        );
      } catch (err) { fail(err, 'splitio', 'change-requests list', start); }
    });

  changeRequests
    .command('get')
    .description('Get a Change Request by ID')
    .requiredOption('--id <id>', 'Change Request ID')
    .action(async (opts: { id: string }) => {
      const start = Date.now();
      try {
        const http = getHttp(program);
        const data = await http.splitio<ChangeRequest>(
          `/internal/api/v2/changeRequests/${encodeURIComponent(opts.id)}`
        );
        success(data, 'splitio', 'change-requests get', start);
      } catch (err) { fail(err, 'splitio', 'change-requests get', start); }
    });
}
