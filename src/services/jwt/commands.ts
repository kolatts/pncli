import { Command } from 'commander';
import { success, fail } from '../../lib/output.js';
import { PncliError } from '../../lib/errors.js';

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new PncliError('Invalid JWT: expected 3 dot-separated parts', 1);
  }

  const [rawHeader, rawPayload, signature] = parts;

  function base64urlDecode(input: string): string {
    // Convert base64url to base64
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(base64urlDecode(rawHeader)) as Record<string, unknown>;
  } catch {
    throw new PncliError('Invalid JWT: header is not valid JSON', 1);
  }

  try {
    payload = JSON.parse(base64urlDecode(rawPayload)) as Record<string, unknown>;
  } catch {
    throw new PncliError('Invalid JWT: payload is not valid JSON', 1);
  }

  return { header, payload, signature };
}

export function registerJwtCommands(program: Command): void {
  const jwt = program.command('jwt').description('JWT token utilities');

  jwt
    .command('decode <token>')
    .description('Decode a JWT token and output header, payload, and signature as JSON')
    .action((token: string) => {
      const start = Date.now();
      try {
        const data = decodeJwt(token);
        success(data, 'jwt', 'decode', start);
      } catch (err) {
        fail(err, 'jwt', 'decode', start);
      }
    });
}
