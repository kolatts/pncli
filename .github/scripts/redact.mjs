// Deterministic redactor for issue, PR and comment text on this public repo.
//
// Rewrites organization names and domains from a denylist (the REDACT_TERMS
// repository secret — deliberately not in the repo, so the list of names never
// becomes public), hosts under internal-only suffixes, private IPv4 addresses,
// and credential-shaped strings. Pure ESM with no dependencies so a workflow
// can run it straight from a sparse checkout without `npm ci`.
//
// Used by .github/workflows/claude-triage.yml. Tests live
// next to it in redact.test.mjs.

import { pathToFileURL } from 'node:url';

/** First labels that survive redaction: `jira.<org>.net` -> `jira.imagile.dev`. */
export const KNOWN_SERVICE_LABELS = new Set([
  'jira', 'bitbucket', 'confluence', 'sonar', 'sonarqube', 'jenkins', 'artifactory',
  'dynatrace', 'sde', 'tfs', 'ado', 'iq', 'ghe', 'github', 'git', 'gitlab', 'splunk',
  'logscale', 'openshift', 'argocd', 'vault', 'nexus', 'figma', 'wiki',
]);

export const INTERNAL_SUFFIXES = ['local', 'internal', 'corp', 'lan', 'intranet', 'localdomain'];

const ORG_MARKER = '[org]';
const SECRET_MARKER = '[redacted-secret]';
const IP_MARKER = '[redacted-ip]';
const PLACEHOLDER_DOMAIN = 'imagile.dev';

// One DNS label. Used to build the host-shaped patterns below.
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
// A hostname entry in REDACT_TERMS: two or more labels, nothing else.
const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);
// Hosts must not start mid-identifier or mid-hostname (`notacme.net`, `x-acme.net`).
const HOST_START = '(?<![A-Za-z0-9.-])';
// ...and must not continue into a longer label (`acme.network`).
const HOST_END = '(?![A-Za-z0-9-])';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse the REDACT_TERMS secret. One entry per line; blank lines and `#`
 * comments are ignored.
 *   - `re:/pattern/flags` -> an explicit regex, replaced with `[org]`
 *   - a hostname (contains a dot, no spaces) -> a DOMAIN, matching itself and every subdomain
 *   - anything else -> a WORD, matched case-insensitively on word boundaries
 * Invalid regex entries are counted, never echoed, so a caller can warn
 * without printing the denylist.
 */
export function parseTerms(text) {
  const terms = { words: [], domains: [], regexes: [], invalid: 0 };
  if (!text) return terms;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('re:')) {
      const m = /^re:\/(.+)\/([a-z]*)$/.exec(line);
      if (!m) {
        terms.invalid++;
        continue;
      }
      try {
        const flags = m[2].includes('g') ? m[2] : `${m[2]}g`;
        const re = new RegExp(m[1], flags);
        // A pattern that can match the empty string would loop forever or
        // insert markers between every character.
        if (re.test('')) {
          terms.invalid++;
          continue;
        }
        re.lastIndex = 0;
        terms.regexes.push(re);
      } catch {
        terms.invalid++;
      }
      continue;
    }

    // Tolerate `*.acme.net`, `.acme.net`, and a trailing dot.
    const host = line.replace(/^\*?\./, '').replace(/\.$/, '').toLowerCase();
    if (host.includes('.') && HOSTNAME_RE.test(host)) {
      if (!terms.domains.includes(host)) terms.domains.push(host);
    } else if (!terms.words.some((w) => w.toLowerCase() === line.toLowerCase())) {
      terms.words.push(line);
    }
  }
  // Longest first, so `acme-int.net` is not pre-empted by a shorter overlapping entry.
  terms.domains.sort((a, b) => b.length - a.length);
  terms.words.sort((a, b) => b.length - a.length);
  return terms;
}

function emptyCounts() {
  return { org: 0, domain: 0, internalHost: 0, privateIp: 0, secret: 0 };
}

/** `jira.foo.acme.net` -> `jira.imagile.dev`; anything else -> `redacted.imagile.dev`. */
function placeholderHost(fullHost, isApex) {
  const first = fullHost.split('.')[0].toLowerCase();
  if (!isApex && KNOWN_SERVICE_LABELS.has(first)) return `${first}.${PLACEHOLDER_DOMAIN}`;
  return `redacted.${PLACEHOLDER_DOMAIN}`;
}

const SECRET_RULES = [
  // `https://user:password@host` -> keep scheme and host, drop the userinfo.
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@:[\]]+:[^\s/?#@]+@/gi,
    replace: (_m, scheme) => `${scheme}${SECRET_MARKER}@`,
  },
  // `Authorization: Bearer|Basic|Token <value>` — keep the scheme word.
  {
    re: /\b(Authorization\s*[:=]\s*["']?)(Bearer|Basic|Token)\s+(?!\[redacted-secret\])[^\s"']+/gi,
    replace: (_m, prefix, scheme) => `${prefix}${scheme} ${SECRET_MARKER}`,
  },
  // Bare `Bearer <token>`; 20+ chars so prose like "bearer tokens" is left alone.
  {
    re: /\b(Bearer)\s+[A-Za-z0-9._~+/-]{20,}=*/g,
    replace: (_m, word) => `${word} ${SECRET_MARKER}`,
  },
  // GitHub classic and fine-grained tokens.
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, replace: () => SECRET_MARKER },
  { re: /\bgithub_pat_[A-Za-z0-9_]{22,}/g, replace: () => SECRET_MARKER },
  // Slack bot/app/user/refresh/legacy tokens.
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => SECRET_MARKER },
  // AWS access key IDs.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => SECRET_MARKER },
  // JWTs: three base64url segments, the header always starting `eyJ` (`{"`).
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, replace: () => SECRET_MARKER },
];

function applySecrets(text, counts) {
  let out = text;
  for (const rule of SECRET_RULES) {
    out = out.replace(rule.re, (...args) => {
      counts.secret++;
      return rule.replace(...args);
    });
  }
  return out;
}

function applyDomains(text, domains, counts) {
  let out = text;
  for (const domain of domains) {
    const re = new RegExp(
      `${HOST_START}((?:${LABEL}\\.)*)${escapeRegex(domain)}${HOST_END}`,
      'gi',
    );
    out = out.replace(re, (match, prefix) => {
      counts.domain++;
      return placeholderHost(match, prefix === '');
    });
  }
  return out;
}

const INTERNAL_RE = new RegExp(
  `${HOST_START}((?:${LABEL}\\.)+)(${INTERNAL_SUFFIXES.join('|')})${HOST_END}`,
  // Deliberately case-sensitive: hostnames are written lowercase, while
  // PascalCase namespaces like `Foo.Bar.Internal` are code, not hosts.
  'g',
);

function applyInternalHosts(text, counts) {
  return text.replace(INTERNAL_RE, (match, prefix, _suffix, offset, whole) => {
    const labels = prefix.split('.').filter(Boolean).length;
    const before = whole.slice(Math.max(0, offset - 3), offset);
    const after = whole.slice(offset + match.length, offset + match.length + 2);
    // A single label before the suffix (`this.local`, `obj.internal`) is far
    // more often code than a host, so only take it with host context around it:
    // a URL scheme, an `@`, or a port.
    const hostContext = before.endsWith('://') || before.endsWith('@') || /^:\d/.test(after);
    if (labels < 2 && !hostContext) return match;
    counts.internalHost++;
    return placeholderHost(match, false);
  });
}

const PRIVATE_IP_RE = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\.?\d)/g;

function isPrivateIpv4(a, b) {
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function applyPrivateIps(text, counts) {
  return text.replace(PRIVATE_IP_RE, (match, ...octets) => {
    const n = octets.slice(0, 4).map(Number);
    if (n.some((o) => o > 255)) return match;
    if (!isPrivateIpv4(n[0], n[1])) return match;
    counts.privateIp++;
    return IP_MARKER;
  });
}

function applyWords(text, words, regexes, counts) {
  let out = text;
  for (const word of words) {
    // Word boundaries on identifier characters, so a short term never matches
    // inside a longer name (`acm` must not hit `acmcli` or `acme`), while
    // `ACM's`, `acm-internal`, and `(acm)` all match.
    const body = escapeRegex(word).replace(/\s+/g, '\\s+');
    const re = new RegExp(`(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])`, 'gi');
    out = out.replace(re, () => {
      counts.org++;
      return ORG_MARKER;
    });
  }
  for (const re of regexes) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      if (m === ORG_MARKER) return m;
      counts.org++;
      return ORG_MARKER;
    });
  }
  return out;
}

/**
 * Redact one string. Rules run in a fixed order — secrets, denylisted domains,
 * internal hosts, private IPs, denylisted words — and the output is a fixed
 * point: running it again changes nothing.
 */
export function redact(text, terms) {
  const counts = emptyCounts();
  if (text === null || text === undefined || text === '') return { text: text ?? '', counts };
  const t = terms ?? parseTerms('');
  let out = String(text);
  out = applySecrets(out, counts);
  out = applyDomains(out, t.domains ?? [], counts);
  out = applyInternalHosts(out, counts);
  out = applyPrivateIps(out, counts);
  out = applyWords(out, t.words ?? [], t.regexes ?? [], counts);
  return { text: out, counts };
}

/** Redact an issue, PR, or comment. A null body stays null. */
export function redactIssue({ title, body }, terms) {
  const counts = emptyCounts();
  const add = (c) => {
    for (const k of Object.keys(counts)) counts[k] += c[k];
  };
  const t = redact(title ?? '', terms);
  add(t.counts);
  let newBody = body ?? null;
  if (body !== null && body !== undefined) {
    const b = redact(body, terms);
    add(b.counts);
    newBody = b.text;
  }
  const newTitle = t.text;
  const changed = newTitle !== (title ?? '') || newBody !== (body ?? null);
  return { title: newTitle, body: newBody, changed, counts };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// CLI: JSON `{title, body}` on stdin, REDACT_TERMS from env, JSON
// `{title, body, changed, counts}` on stdout. Never prints the terms or the
// matched text — diagnostics on stderr are counts only.
async function main() {
  const input = JSON.parse(await readStdin());
  const terms = parseTerms(process.env.REDACT_TERMS ?? '');
  if (terms.invalid > 0) {
    process.stderr.write(`redact: ignored ${terms.invalid} invalid REDACT_TERMS entr${terms.invalid === 1 ? 'y' : 'ies'}\n`);
  }
  const result = redactIssue({ title: input.title ?? '', body: input.body ?? null }, terms);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // The message of a JSON parse error can quote the input; keep it generic.
    process.stderr.write(`redact: failed (${err?.name ?? 'Error'})\n`);
    process.exit(1);
  });
}
