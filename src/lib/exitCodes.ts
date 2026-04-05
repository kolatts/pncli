export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  NETWORK_ERROR: 69,    // EX_UNAVAILABLE from sysexits.h
  AUTH_ERROR: 77,       // EX_NOPERM from sysexits.h
  CONFIG_ERROR: 78,     // EX_CONFIG from sysexits.h
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export function exitCodeFromStatus(httpStatus: number): number {
  if (httpStatus === 401 || httpStatus === 403) return ExitCode.AUTH_ERROR;
  if (httpStatus === 0) return ExitCode.NETWORK_ERROR;
  return ExitCode.GENERAL_ERROR;
}
