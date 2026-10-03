/**
 * TLS trust setup, run once at startup before any request is made.
 *
 * Certificate verification is always on; pncli has no switch to turn it off.
 * To keep that working behind corporate SSL-inspection proxies, pncli trusts
 * the OS certificate store in addition to Node's bundled Mozilla CAs — the
 * same thing `NODE_USE_SYSTEM_CA=1` does. Corporate root CAs are pushed to the
 * OS store by IT (Group Policy, MDM, update-ca-certificates), so this makes
 * pncli trust whatever the user's browser already trusts, with no setup.
 *
 * `NODE_USE_SYSTEM_CA` is read by Node only at process start, so setting it
 * from here would do nothing. `tls.setDefaultCACertificates` (Node 22.19+,
 * which is why `engines.node` is pinned there) changes the default trust store
 * at runtime instead, and both the built-in fetch and the undici proxy agent
 * pick it up because neither passes its own `ca`.
 */
import tls from 'node:tls';

type TlsApi = Pick<typeof tls, 'getCACertificates' | 'setDefaultCACertificates'>;

export const INSECURE_TLS_WARNING =
  'warning: NODE_TLS_REJECT_UNAUTHORIZED=0 is set, so pncli will NOT verify server certificates. ' +
  'Anyone on the network path can read or alter requests and responses, including your credentials and any writes. ' +
  'Unset it and trust the proxy or internal CA instead: install its root certificate in the OS store ' +
  'or set NODE_EXTRA_CA_CERTS=/path/to/ca.pem.\n';

export function configureTls(env: NodeJS.ProcessEnv = process.env, api: TlsApi = tls): void {
  // pncli never sets this, but a shell profile or CI image may. Node's own
  // one-line warning does not say what is at risk or what to do instead.
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.stderr.write(INSECURE_TLS_WARNING);

  // Any explicit value is the user's decision: `1` means Node already loaded
  // the system store at startup, and anything else (`0`) opts out of it.
  if (env.NODE_USE_SYSTEM_CA !== undefined) return;

  try {
    // 'default' already includes NODE_EXTRA_CA_CERTS, so that keeps working.
    const merged = new Set([...api.getCACertificates('default'), ...api.getCACertificates('system')]);
    api.setDefaultCACertificates([...merged]);
  } catch (err: unknown) {
    // Verification stays on with Node's bundled CAs; say why a corporate CA
    // might now be rejected rather than failing later with no context.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warning: could not load the OS certificate store (${msg}); only Node's bundled CAs are trusted.\n`);
  }
}

/**
 * Hints for certificate errors, keyed by the `code` Node puts on the cause of
 * a failed fetch. Only chain-of-trust failures are fixed by trusting a CA; a
 * hostname mismatch or an expired certificate needs a different fix.
 */
const UNTRUSTED_HINT =
  'The certificate is not trusted by Node\'s bundled CAs or the OS certificate store. ' +
  'If your network uses an SSL-inspecting proxy or an internal CA, install its root certificate in the OS store ' +
  'or set NODE_EXTRA_CA_CERTS=/path/to/ca.pem. For a self-signed server, export its certificate from the browser ' +
  'and point NODE_EXTRA_CA_CERTS at that file.';

const TLS_ERROR_HINTS: Record<string, string> = {
  SELF_SIGNED_CERT_IN_CHAIN: UNTRUSTED_HINT,
  DEPTH_ZERO_SELF_SIGNED_CERT: UNTRUSTED_HINT,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: UNTRUSTED_HINT,
  UNABLE_TO_GET_ISSUER_CERT: UNTRUSTED_HINT,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: UNTRUSTED_HINT,
  CERT_UNTRUSTED: UNTRUSTED_HINT,
  ERR_TLS_CERT_ALTNAME_INVALID:
    'The certificate does not match the host in the URL. Use the hostname the certificate was issued for ' +
    '(usually the fully qualified name, not a short alias or IP address) in baseUrl.',
  CERT_HAS_EXPIRED:
    'The server\'s certificate has expired. Check the system clock; otherwise the server owner needs to renew it.',
  CERT_NOT_YET_VALID:
    'The server\'s certificate is not valid yet. Check the system clock.',
};

const NODE_SYSTEM_CA_ADVICE = /;? ?if the root CA is installed locally, try running Node\.js with --use-system-ca\.?/;

/**
 * Describe a rejected fetch. Node's built-in fetch reports every network
 * failure as "fetch failed" and hides the real reason (ECONNREFUSED, DNS,
 * TLS) in `err.cause`; this surfaces it and, for certificate errors, adds how
 * to fix it.
 */
export function describeFetchError(err: unknown): string {
  const topMsg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  const causeMsg = cause instanceof Error ? cause.message : undefined;
  const causeCode = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined;
  const hint = typeof causeCode === 'string' ? TLS_ERROR_HINTS[causeCode] : undefined;
  // Node 24 appends its own "try running Node.js with --use-system-ca" advice to
  // untrusted-chain errors. pncli already trusts the system store, so drop it.
  const detail = hint && causeMsg ? causeMsg.replace(NODE_SYSTEM_CA_ADVICE, '') : causeMsg;
  return (detail ? `${topMsg}: ${detail}` : topMsg) + (hint ? `. ${hint}` : '');
}
