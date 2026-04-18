import { describe, it, expect } from 'vitest';
import { ExitCode, exitCodeFromStatus } from './exitCodes.js';

describe('ExitCode', () => {
  it('has expected values', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.USAGE_ERROR).toBe(2);
    expect(ExitCode.NETWORK_ERROR).toBe(69);
    expect(ExitCode.AUTH_ERROR).toBe(77);
    expect(ExitCode.CONFIG_ERROR).toBe(78);
  });
});

describe('exitCodeFromStatus', () => {
  it('returns AUTH_ERROR for 401', () => {
    expect(exitCodeFromStatus(401)).toBe(ExitCode.AUTH_ERROR);
  });

  it('returns AUTH_ERROR for 403', () => {
    expect(exitCodeFromStatus(403)).toBe(ExitCode.AUTH_ERROR);
  });

  it('returns NETWORK_ERROR for 0', () => {
    expect(exitCodeFromStatus(0)).toBe(ExitCode.NETWORK_ERROR);
  });

  it('returns GENERAL_ERROR for 400', () => {
    expect(exitCodeFromStatus(400)).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR for 500', () => {
    expect(exitCodeFromStatus(500)).toBe(ExitCode.GENERAL_ERROR);
  });

  it('returns GENERAL_ERROR for 404', () => {
    expect(exitCodeFromStatus(404)).toBe(ExitCode.GENERAL_ERROR);
  });
});
