import fs from 'fs';
import chalk from 'chalk';
import type { Meta, SuccessEnvelope, ErrorEnvelope, ErrorDetail } from '../types/common.js';
import { PncliError } from './errors.js';
import { ExitCode, exitCodeFromStatus } from './exitCodes.js';

let globalOptions = { pretty: false, verbose: false };
let globalUser: { email: string | undefined; userId: string | undefined } = { email: undefined, userId: undefined };
let outputFile: string | undefined;

export function setGlobalOptions(opts: { pretty: boolean; verbose: boolean; outputFile?: string }): void {
  globalOptions = { pretty: opts.pretty, verbose: opts.verbose };
  outputFile = opts.outputFile;
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

function writeToFile(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (writeErr) {
    process.stderr.write(
      `Warning: could not write to output file "${filePath}": ${(writeErr as NodeJS.ErrnoException).message}\n`
    );
    process.exitCode = ExitCode.GENERAL_ERROR;
  }
}

export function success<T>(data: T, service: string, action: string, startTime: number): void {
  const envelope: SuccessEnvelope<T> = {
    ok: true,
    data,
    meta: buildMeta(service, action, startTime)
  };
  const out = (globalOptions.pretty ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope)) + '\n';
  if (outputFile) {
    writeToFile(outputFile, out);
  } else {
    process.stdout.write(out);
  }
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
  if (outputFile) {
    writeToFile(outputFile, output);
  } else {
    try {
      fs.writeSync(process.stdout.fd, output);
    } catch (writeErr) {
      if ((writeErr as NodeJS.ErrnoException).code !== 'EPIPE') throw writeErr;
    }
  }
  process.exitCode = exitCode;
  throw new PncliError(errorDetail.message, errorDetail.status);
}

export function writeRawOutput(content: string): void {
  if (outputFile) {
    writeToFile(outputFile, content);
  } else {
    process.stdout.write(content);
  }
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
