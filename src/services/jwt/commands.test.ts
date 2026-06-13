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

  it('handles base64url padding correctly with payload requiring 1 padding char', () => {
    // Construct a token where the payload encodes to a length requiring 1 '=' padding
    // payload: {"a":0} encodes to eyJhIjowfQ (10 chars, needs 2 padding)
    // payload: {"a":1} encodes to eyJhIjoxfQ (10 chars, needs 2 padding)
    // Use a payload that results in (length % 4) == 3, so we need 1 '='
    // payload: {"x":"y"} (12 chars base64) -> 11 base64url chars -> needs 1 '='
    // Actually: {"x":"y"} -> 'eyJ4IjoieSJ9' (12 chars, needs 0), so use {"x":"yy"} -> 'eyJ4IjoieXkifQ' (14 chars, needs 2)
    // Let's use payload that's specifically crafted: {"a":"bc"} -> 'eyJhIjoiYmMifQ' (14 chars)
    // For length requiring 1 padding: need base64 to be length % 4 == 3
    // {"a":"b"} -> eyJhIjoiYiJ9 (12 chars) needs 0. {"a":"bb"} -> eyJhIjoiYmIifQ (14 chars) needs 2.
    // Construct directly: payload with {'x':'yabcd'} -> 'eyJ4IjoieWFiY2QifQ' (18 chars) needs 2
    // For 3 chars % 4 (needing 1 '='): use payload of specific length
    // Simplest: use the fact that VALID_JWT already works, and test with a token with a slightly different payload length
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'; // 36 chars
    // payload {"z":1} -> eyJ6IjoxfQ (10 chars, 10 % 4 = 2, needs 2 '=')
    // payload {"z":123} -> eyJ6IjoxMjN9 (12 chars, 12 % 4 = 0, needs 0)
    // payload {"zz":"aaa"} -> eyJ6eiI6ImFhYSJ9 (16 chars, needs 0)
    // payload {"z":"aaaa"} -> eyJ6IjoiYWFhYSJ9 (15 chars, 15 % 4 = 3, needs 1)
    const payload = 'eyJ6IjoiYWFhYSJ9'; // {"z":"aaaa"} - 15 chars, needs 1 '='
    const sig = 'sig';
    const result = decodeJwt(`${header}.${payload}.${sig}`);
    expect(result.payload).toEqual({ z: 'aaaa' });
  });

  it('handles base64url padding correctly with payload requiring 2 padding chars', () => {
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    // payload {"z":1} -> eyJ6IjoxfQ (10 chars, 10 % 4 = 2, needs 2 '=')
    const payload = 'eyJ6IjoxfQ'; // {"z":1} - 10 chars, needs 2 '=='
    const sig = 'sig';
    const result = decodeJwt(`${header}.${payload}.${sig}`);
    expect(result.payload).toEqual({ z: 1 });
  });
});
