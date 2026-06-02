import { describe, it, expect } from 'vitest';
import { decodeJwt } from './commands.js';

// A real JWT with known content:
// header:  {"alg":"HS256","typ":"JWT"}
// payload: {"sub":"1234567890","name":"John Doe","iat":1516239022}
const VALID_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ' +
  '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('decodeJwt', () => {
  it('decodes header correctly', () => {
    const result = decodeJwt(VALID_JWT);
    expect(result.header).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('decodes payload correctly', () => {
    const result = decodeJwt(VALID_JWT);
    expect(result.payload).toEqual({
      sub: '1234567890',
      name: 'John Doe',
      iat: 1516239022,
    });
  });

  it('returns the raw signature string', () => {
    const result = decodeJwt(VALID_JWT);
    expect(result.signature).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('throws on a token with fewer than 3 parts', () => {
    expect(() => decodeJwt('header.payload')).toThrow('Invalid JWT: expected 3 dot-separated parts');
  });

  it('throws on a token with more than 3 parts', () => {
    expect(() => decodeJwt('a.b.c.d')).toThrow('Invalid JWT: expected 3 dot-separated parts');
  });

  it('throws when header is not valid base64url JSON', () => {
    // "!!!" is not valid base64url
    expect(() => decodeJwt('!!!.eyJzdWIiOiIxIn0.sig')).toThrow();
  });

  it('throws when payload is not valid base64url JSON', () => {
    // valid header, invalid payload
    const validHeader = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    expect(() => decodeJwt(`${validHeader}.notjson.sig`)).toThrow('Invalid JWT: payload is not valid JSON');
  });

  it('handles base64url padding correctly (no padding in JWT)', () => {
    // JWT base64url has no padding — ensure decode works for all lengths
    const result = decodeJwt(VALID_JWT);
    expect(result.header.alg).toBe('HS256');
  });
});
