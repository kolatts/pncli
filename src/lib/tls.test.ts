import { describe, it, expect, vi, afterEach } from 'vitest';
import { configureTls, describeFetchError } from './tls.js';

function stubTls(system: string[] = ['SYS'], fail = false) {
  return {
    getCACertificates: vi.fn((type?: string) => {
      if (fail && type === 'system') throw new Error('store unavailable');
      return type === 'system' ? system : ['BUNDLED', 'SYS'];
    }),
    setDefaultCACertificates: vi.fn()
  };
}

describe('configureTls', () => {
  afterEach(() => vi.restoreAllMocks());

  it('trusts the OS certificate store alongside the default CAs, without duplicates', () => {
    const api = stubTls(['SYS', 'CORP-ROOT']);
    configureTls({}, api as never);
    expect(api.setDefaultCACertificates).toHaveBeenCalledWith(['BUNDLED', 'SYS', 'CORP-ROOT']);
  });

  it('leaves verification on and trust untouched when NODE_USE_SYSTEM_CA is set either way', () => {
    for (const value of ['1', '0']) {
      const env: NodeJS.ProcessEnv = { NODE_USE_SYSTEM_CA: value };
      const api = stubTls();
      configureTls(env, api as never);
      expect(api.setDefaultCACertificates).not.toHaveBeenCalled();
      expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    }
  });

  it('disables verification with a warning when PNCLI_INSECURE_TLS is set', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const value of ['1', 'true', 'TRUE']) {
      const env: NodeJS.ProcessEnv = { PNCLI_INSECURE_TLS: value };
      configureTls(env, stubTls() as never);
      expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0');
    }
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('verification is disabled'));
  });

  it('keeps verification on when PNCLI_INSECURE_TLS is anything else', () => {
    const env: NodeJS.ProcessEnv = { PNCLI_INSECURE_TLS: '0' };
    const api = stubTls();
    configureTls(env, api as never);
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(api.setDefaultCACertificates).toHaveBeenCalled();
  });

  it('warns and continues with the bundled CAs when the OS store cannot be read', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const api = stubTls([], true);
    expect(() => configureTls({}, api as never)).not.toThrow();
    expect(api.setDefaultCACertificates).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('store unavailable'));
  });
});

describe('describeFetchError', () => {
  const fetchFailed = (code: string, message = 'tls failure') =>
    Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error(message), { code }) });

  it('points untrusted-chain errors at the OS store and NODE_EXTRA_CA_CERTS', () => {
    const msg = describeFetchError(fetchFailed('SELF_SIGNED_CERT_IN_CHAIN', 'self-signed certificate in certificate chain'));
    expect(msg).toContain('fetch failed: self-signed certificate in certificate chain.');
    expect(msg).toContain('OS store');
    expect(msg).toContain('NODE_EXTRA_CA_CERTS');
    expect(msg).toContain('PNCLI_INSECURE_TLS=1');
  });

  it("drops Node's own --use-system-ca advice, since pncli already trusts the system store", () => {
    const msg = describeFetchError(fetchFailed(
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'
    ));
    expect(msg).toMatch(/^fetch failed: self-signed certificate\. The certificate is not trusted/);
    expect(msg).not.toContain('--use-system-ca');
  });

  it('tells a hostname mismatch to fix baseUrl, not to trust a CA or disable verification', () => {
    const msg = describeFetchError(fetchFailed('ERR_TLS_CERT_ALTNAME_INVALID'));
    expect(msg).toContain('baseUrl');
    expect(msg).not.toContain('NODE_EXTRA_CA_CERTS');
    expect(msg).not.toContain('PNCLI_INSECURE_TLS');
  });

  it('tells an expired certificate to check the clock', () => {
    expect(describeFetchError(fetchFailed('CERT_HAS_EXPIRED'))).toContain('system clock');
  });

  it('adds no hint for non-certificate errors', () => {
    expect(describeFetchError(fetchFailed('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:443')))
      .toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:443');
    expect(describeFetchError(new Error('fetch failed'))).toBe('fetch failed');
    expect(describeFetchError('boom')).toBe('boom');
  });
});
