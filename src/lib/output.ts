import chalk from 'chalk';
import type { Meta, SuccessEnvelope, ErrorEnvelope, ErrorDetail } from '../types/common.js';
import { PncliError } from './errors.js';

let globalOptions = { pretty: false, verbose: false };

export function setGlobalOptions(opts: { pretty: boolean; verbose: boolean }): void {
  globalOptions = opts;
}

function buildMeta(service: string, action: string, startTime: number): Meta {
  return {
    service,
    action,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime
  };
}

export function success<T>(data: T, service: string, action: string, startTime: number): void {
  const envelope: SuccessEnvelope<T> = {
    ok: true,
    data,
    meta: buildMeta(service, action, startTime)
  };
  process.stdout.write(
    (globalOptions.pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)) + '\n'
  );
}

export function fail(
  err: unknown,
  service: string,
  action: string,
  startTime: number
): never {
  const errorDetail: ErrorDetail = {
    status: err instanceof PncliError ? err.status : 1,
    message: err instanceof Error ? err.message : String(err),
    url: err instanceof PncliError ? (err.url ?? null) : null
  };

  const envelope: ErrorEnvelope = {
    ok: false,
    error: errorDetail,
    meta: buildMeta(service, action, startTime)
  };

  const msg = globalOptions.pretty
    ? chalk.red('✗ Error: ') + errorDetail.message
    : null;

  if (msg) process.stderr.write(msg + '\n');

  process.stdout.write(
    (globalOptions.pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)) + '\n'
  );

  process.exit(1);
}

export function log(message: string): void {
  if (globalOptions.verbose) {
    process.stderr.write(
      (globalOptions.pretty ? chalk.gray('▸ ') : '') + message + '\n'
    );
  }
}

export function warn(message: string): void {
  process.stderr.write(
    (globalOptions.pretty ? chalk.yellow('⚠ ') : '') + message + '\n'
  );
}
