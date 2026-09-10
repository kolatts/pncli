import { describe, it, expect } from 'vitest';
import { PncliError } from './errors.js';

describe('PncliError', () => {
  it('sets name to PncliError', () => {
    const err = new PncliError('boom');
    expect(err.name).toBe('PncliError');
  });

  it('is an instance of Error', () => {
    expect(new PncliError('x')).toBeInstanceOf(Error);
  });

  it('sets message', () => {
    expect(new PncliError('something went wrong').message).toBe('something went wrong');
  });

  it('defaults status to 1', () => {
    expect(new PncliError('x').status).toBe(1);
  });

  it('accepts explicit status', () => {
    expect(new PncliError('x', 404).status).toBe(404);
  });

  it('defaults url to undefined', () => {
    expect(new PncliError('x').url).toBeUndefined();
  });

  it('accepts url', () => {
    expect(new PncliError('x', 500, 'https://api.imagile.dev').url).toBe('https://api.imagile.dev');
  });

  it('defaults retryAfterSeconds to undefined', () => {
    expect(new PncliError('x').retryAfterSeconds).toBeUndefined();
  });

  it('accepts retryAfterSeconds', () => {
    expect(new PncliError('x', 429, 'https://api.imagile.dev', 86400).retryAfterSeconds).toBe(86400);
  });
});
