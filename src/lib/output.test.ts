import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PncliError } from './errors.js';
import { fail, setGlobalOptions } from './output.js';
import { exitCodeFromStatus } from './exitCodes.js';

describe('rate limit error output', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it.each([86400, 0, undefined])('serializes retryAfterSeconds=%s without changing existing fields', (seconds) => {
    setGlobalOptions({ pretty: false, verbose: false });
    const write = vi.spyOn(fs, 'writeSync').mockReturnValue(0);
    const error = new PncliError('Rate limited', 429, 'https://figma.imagile.dev/v1/me', seconds);

    expect(() => fail(error, 'figma', 'me', Date.now())).toThrow('Rate limited');

    const envelope = JSON.parse(String(write.mock.calls[0][1]));
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toEqual({
      status: 429,
      message: 'Rate limited',
      url: 'https://figma.imagile.dev/v1/me',
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds })
    });
    expect(process.exitCode).toBe(exitCodeFromStatus(429));
  });
});
