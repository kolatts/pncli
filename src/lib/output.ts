import chalk from 'chalk';
import type { Meta, SuccessEnvelope, ErrorEnvelope, ErrorDetail } from '../types/common.js';
import { PncliError } from './errors.js';
import { ExitCode, exitCodeFromStatus } from './exitCodes.js';

let globalOptions = { pretty: false, verbose: false };
let globalUser: { email: string | undefined; userId: string | undefined } = { email: undefined, userId: undefined };

export function setGlobalOptions(opts: { pretty: boolean; verbose: boolean }): void {
  globalOptions = opts;
}

export function setGlobalUser(user: { email: string | undefined; userId: string | undefined }): void {
  globalUser = user;
}

function buildMeta(service: string, action: string, startTime: number): Meta {
  return {
    service,
    action,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    user: (globalUser.email ?? globalUser.userId) ? globalUser : undefined
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

  const output = (globalOptions.pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)) + '\n';
  const exitCode = err instanceof PncliError ? exitCodeFromStatus(err.status) : ExitCode.GENERAL_ERROR;
  process.stdout.write(output, () => process.exit(exitCode));
  throw new PncliError(errorDetail.message, errorDetail.status);
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
