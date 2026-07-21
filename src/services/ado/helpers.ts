import { Command } from 'commander';
import { loadConfig } from '../../lib/config.js';
import { createHttpClient } from '../../lib/http.js';
import { getGitContext } from '../../lib/git-context.js';
import { PncliError } from '../../lib/errors.js';
import { log } from '../../lib/output.js';
import { resolveAtFileRef } from '../../lib/input.js';
import { ADO_FIELD_ALIAS_CANDIDATES } from './discovery.js';
import { AdoCoreClient } from './client/core.js';
import { AdoWorkClient } from './client/work.js';
import { AdoGitClient } from './client/git.js';
import { AdoBuildClient } from './client/build.js';
import type { JsonPatchOp } from './client/work.js';
import type { AdoBuild } from '../../types/ado.js';

export interface AdoContext {
  collection: string;
  project: string;
  repo: string;
  coreClient: AdoCoreClient;
  workClient: AdoWorkClient;
  gitClient: AdoGitClient;
  buildClient: AdoBuildClient;
}

/**
 * Resolves ADO (collection, project, repo) from CLI flags → git remote → config defaults.
 * Mirrors the getClient() helper in bitbucket/commands.ts.
 */
export function getAdoContext(program: Command, requireRepo = false): AdoContext {
  const opts = program.optsWithGlobals();
  const config = loadConfig({ configPath: opts.config });
  const http = createHttpClient(config, Boolean(opts.dryRun));
  const ctx = getGitContext(config);

  const collection: string =
    opts.collection ?? opts.organization ??
    ctx?.ado?.collection ??
    config.defaults.ado?.collection ?? '';

  const project: string =
    opts.project ??
    ctx?.ado?.project ??
    config.defaults.ado?.project ?? '';

  const repo: string =
    opts.repo ??
    ctx?.ado?.repo ??
    config.defaults.ado?.repo ?? '';

  if (!collection) {
    throw new PncliError(
      'Could not determine Azure DevOps collection. Pass --collection, or run pncli config init.',
      1
    );
  }

  if (!project) {
    throw new PncliError(
      'Could not determine Azure DevOps project. Pass --project, or run pncli config init.',
      1
    );
  }

  if (requireRepo && !repo) {
    throw new PncliError(
      'Could not determine Azure DevOps repo. Pass --repo, or run from inside a checked-out ADO repo.',
      1
    );
  }

  return {
    collection,
    project,
    repo,
    coreClient: new AdoCoreClient(http),
    workClient: new AdoWorkClient(http),
    gitClient: new AdoGitClient(http),
    buildClient: new AdoBuildClient(http)
  };
}

// ── Field helpers ─────────────────────────────────────────────────────

/**
 * Parses repeated --field name=value arguments into a Record.
 * Accepts "name=value" strings (split on first =). Throws on missing `=`.
 */
export function parseFieldArgs(fields: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of fields) {
    const eq = f.indexOf('=');
    if (eq <= 0) throw new PncliError(`Invalid --field value "${f}". Expected format: name=value`, 1);
    result[f.slice(0, eq)] = f.slice(eq + 1);
  }
  return result;
}

const stripSeparators = (s: string): string => s.toLowerCase().replace(/[\s-]+/g, '');

/**
 * Built-in fallback for the handful of near-universal ADO fields (Description, Acceptance
 * Criteria, Priority, ...), used when a key isn't in the user's saved fieldAliases (i.e.
 * `pncli ado work fields --save` hasn't been run yet). This is what lets Description /
 * Acceptance Criteria work out of the box via --field or --input-file without requiring
 * discovery first; a project whose process doesn't have a given field will simply get a
 * clear 400 from the ADO API, same as passing any other wrong field id.
 */
const DEFAULT_ADO_FIELD_ALIASES: Record<string, string> = Object.fromEntries(ADO_FIELD_ALIAS_CANDIDATES);

/**
 * Resolves field keys against the loaded alias map, then builds JSON Patch ops.
 * If a key is in fieldAliases → use the reference name. Otherwise use the key as-is.
 * Falls back to a case/space/dash-insensitive alias match (aliases — both the user's saved
 * ones and the built-in defaults — are typically stored space/dash-free, e.g.
 * "acceptancecriteria"), so a human-friendly "Acceptance Criteria" key from --field or
 * --input-file still resolves without the caller needing to know that.
 */
export function buildFieldPatch(
  fields: Record<string, unknown>,
  fieldAliases: Record<string, string>
): JsonPatchOp[] {
  const aliases = { ...DEFAULT_ADO_FIELD_ALIASES, ...fieldAliases };
  return Object.entries(fields).map(([key, value]) => {
    let refName: string | undefined = aliases[key.toLowerCase()] ?? aliases[key];
    if (!refName) {
      const target = stripSeparators(key);
      const match = Object.entries(aliases).find(([aliasKey]) => stripSeparators(aliasKey) === target);
      refName = match?.[1];
    }
    return { op: 'add' as const, path: `/fields/${refName ?? key}`, value };
  });
}

/** Convenience: parse --field args and immediately build the patch ops. */
export function fieldArgsToPatch(
  fieldArgs: string[],
  fieldAliases: Record<string, string>
): JsonPatchOp[] {
  return buildFieldPatch(parseFieldArgs(fieldArgs), fieldAliases);
}

const BUILTIN_WORK_FIELD_KEYS = new Set(['title', 'description', 'assignee', 'assignedto', 'priority']);

/**
 * Splits a --input-file `fields` dictionary into the small set of built-in work item
 * fields work-create/work-update expose as their own flags (title, description, assignee,
 * priority) and everything else. Non-builtin keys (e.g. "Acceptance Criteria", or a raw
 * reference name like "Microsoft.VSTS.Common.AcceptanceCriteria") are left as-is — they
 * already resolve generically through fieldAliases (see buildFieldPatch), so no custom
 * field needs to be pre-registered in config to be usable here. Resolves `@file` value
 * references (see resolveAtFileRef) on every value.
 */
export function splitWorkFieldsDictionary(
  fields: Record<string, unknown>
): { builtin: Record<string, unknown>; custom: Record<string, unknown> } {
  const builtin: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(fields)) {
    const value = resolveAtFileRef(rawValue);
    const key = rawKey.toLowerCase().replace(/\s+/g, '');
    if (BUILTIN_WORK_FIELD_KEYS.has(key)) {
      builtin[key === 'assignedto' ? 'assignee' : key] = value;
    } else {
      custom[rawKey] = value;
    }
  }
  return { builtin, custom };
}

// ── Vote constants ────────────────────────────────────────────────────

export const PR_VOTE = {
  APPROVE: 10,
  APPROVE_WITH_SUGGESTIONS: 5,
  NO_VOTE: 0,
  WAIT_FOR_AUTHOR: -5,
  REJECT: -10
} as const;

// ── Build polling ─────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed']);

export function isBuildTerminal(build: AdoBuild): boolean {
  return TERMINAL_STATUSES.has(build.status);
}

export interface PollOpts {
  timeoutSec: number;
  pollSec: number;
}

/**
 * Polls fetchStatus() until isTerminal() returns true or timeout is reached.
 * Progress lines emitted via log() (verbose-only stderr); stdout stays clean.
 */
export async function pollUntilTerminal<T>(
  fetchStatus: () => Promise<T>,
  isTerminal: (s: T) => boolean,
  opts: PollOpts
): Promise<T> {
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let status = await fetchStatus();

  while (!isTerminal(status)) {
    if (Date.now() >= deadline) {
      throw new PncliError(
        `Timed out waiting for completion after ${opts.timeoutSec}s`,
        1
      );
    }
    log(`Waiting ${opts.pollSec}s...`);
    await new Promise(resolve => setTimeout(resolve, opts.pollSec * 1000));
    status = await fetchStatus();
  }

  return status;
}
