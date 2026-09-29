import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTerms, redact, redactIssue } from './redact.mjs';

// Fictional organizations only. The real denylist lives in the REDACT_TERMS
// repository secret and must never appear in this repo.
const TERMS = parseTerms(['acmebank', 'acm', 'initech', 'acme-int.net', 'initech.io'].join('\n'));

const r = (text, terms = TERMS) => redact(text, terms);

describe('parseTerms', () => {
  it('ignores blank lines and comments', () => {
    const t = parseTerms('\n# a comment\n  \nacmebank\n   # indented comment\n');
    expect(t.words).toEqual(['acmebank']);
    expect(t.domains).toEqual([]);
  });

  it('treats dotted hostnames as domains and everything else as words', () => {
    const t = parseTerms('acmebank\nACME-INT.NET\n*.initech.io\nAcme Bank Inc.');
    expect(t.domains.sort()).toEqual(['acme-int.net', 'initech.io']);
    expect(t.words.sort()).toEqual(['Acme Bank Inc.', 'acmebank']);
  });

  it('parses re: entries and adds the g flag', () => {
    const t = parseTerms('re:/acme[- ]?corp/i');
    expect(t.regexes).toHaveLength(1);
    expect(t.regexes[0].flags).toContain('g');
    expect(t.regexes[0].flags).toContain('i');
  });

  it('counts invalid regex entries instead of throwing', () => {
    const t = parseTerms('re:/([/\nre:/a*/\nre:nope\nacmebank');
    expect(t.invalid).toBe(3);
    expect(t.regexes).toHaveLength(0);
    expect(t.words).toEqual(['acmebank']);
  });

  it('handles empty and undefined input', () => {
    expect(parseTerms('')).toEqual({ words: [], domains: [], regexes: [], invalid: 0 });
    expect(parseTerms(undefined).words).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    expect(parseTerms('acmebank\r\ninitech\r\n').words.sort()).toEqual(['acmebank', 'initech']);
  });
});

describe('denylisted words', () => {
  it.each([
    ['ACM', '[org]'],
    ['acm', '[org]'],
    ["ACM's Jira", "[org]'s Jira"],
    ['acm-internal', '[org]-internal'],
    ['(acm)', '([org])'],
    ['We use it at AcmeBank daily.', 'We use it at [org] daily.'],
    ['github.com/acm/repo', 'github.com/[org]/repo'],
    ['"acm"', '"[org]"'],
  ])('redacts %j', (input, expected) => {
    expect(r(input).text).toBe(expected);
  });

  it.each(['acmcli', 'acme', 'myacm', 'acm_tool', 'acm2', 'initechnology'])(
    'does not match inside the longer identifier %j',
    (input) => {
      expect(r(input).text).toBe(input);
      expect(r(input).counts.org).toBe(0);
    },
  );

  it('matches multi-word terms across varying whitespace', () => {
    const t = parseTerms('Acme Bank');
    expect(redact('works at acme   bank now', t).text).toBe('works at [org] now');
    expect(redact('works at acme\nbank now', t).text).toBe('works at [org] now');
  });

  it('applies explicit regex entries', () => {
    const t = parseTerms('re:/acme[- ]?corp/i');
    const out = redact('Acme-Corp and ACMECORP and acme corp', t);
    expect(out.text).toBe('[org] and [org] and [org]');
    expect(out.counts.org).toBe(3);
  });

  it('counts every occurrence', () => {
    expect(r('acm, ACM, Acm').counts.org).toBe(3);
  });
});

describe('denylisted domains', () => {
  it.each([
    ['https://jira.acme-int.net/browse/X-1', 'https://jira.imagile.dev/browse/X-1'],
    ['JIRA.ACME-INT.NET', 'jira.imagile.dev'],
    ['see acme-int.net for details', 'see redacted.imagile.dev for details'],
    ['ACME-INT.NET', 'redacted.imagile.dev'],
    ['build01.acme-int.net', 'redacted.imagile.dev'],
    ['https://bitbucket.dc2.acme-int.net:7990/scm', 'https://bitbucket.imagile.dev:7990/scm'],
    ['git@bitbucket.acme-int.net:proj/repo.git', 'git@bitbucket.imagile.dev:proj/repo.git'],
    ['someone@mail.acme-int.net', '[redacted-email]'],
    ['someone@acme-int.net', '[redacted-email]'],
    ['sonar.initech.io', 'sonar.imagile.dev'],
    ['(https://wiki.acme-int.net).', '(https://wiki.imagile.dev).'],
  ])('rewrites %j', (input, expected) => {
    expect(r(input).text).toBe(expected);
    expect(r(input).counts.domain).toBeGreaterThan(0);
  });

  it.each(['notacme-int.net', 'x-acme-int.net', 'acme-int.network', 'acme-int.nets'])(
    'leaves the unrelated host %j alone',
    (input) => {
      expect(r(input).text).toBe(input);
    },
  );

  it('keeps every known service label and drops unknown ones', () => {
    const t = parseTerms('acme-int.net');
    for (const label of ['jenkins', 'artifactory', 'ghe', 'logscale', 'argocd', 'vault', 'nexus']) {
      expect(redact(`${label}.acme-int.net`, t).text).toBe(`${label}.imagile.dev`);
    }
    expect(redact('payroll.acme-int.net', t).text).toBe('redacted.imagile.dev');
  });
});

describe('internal hostnames', () => {
  it.each([
    ['http://jenkins.build.corp/job/x', 'http://jenkins.imagile.dev/job/x'],
    ['https://nexus.local:8081', 'https://nexus.imagile.dev:8081'],
    ['db01.prod.internal', 'redacted.imagile.dev'],
    ['sonar.dev.lan', 'sonar.imagile.dev'],
    ['portal.hr.intranet', 'redacted.imagile.dev'],
    ['host1.localdomain:22', 'redacted.imagile.dev:22'],
    ['svc@mail.corp', '[redacted-email]'],
  ])('rewrites %j', (input, expected) => {
    expect(r(input).text).toBe(expected);
    expect(r(input).counts.internalHost).toBe(1);
  });

  it.each([
    'this.local = 1',
    'obj.internal()',
    '~/.local/share/pncli',
    'Microsoft.Extensions.Internal',
    'the local network',
    'corp.example.org',
  ])('leaves %j alone', (input) => {
    expect(r(input).text).toBe(input);
  });
});

describe('private IPs', () => {
  it.each([
    ['10.1.2.3', '[redacted-ip]'],
    ['connect to 172.16.0.5:8080', 'connect to [redacted-ip]:8080'],
    ['172.31.255.255', '[redacted-ip]'],
    ['192.168.1.10.', '[redacted-ip].'],
    ['cidr 10.0.0.0/8', 'cidr [redacted-ip]/8'],
  ])('redacts %j', (input, expected) => {
    expect(r(input).text).toBe(expected);
    expect(r(input).counts.privateIp).toBe(1);
  });

  it.each(['127.0.0.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '10.0.0.256', '1.10.0.0.1', 'v5.3.0'])(
    'leaves %j alone',
    (input) => {
      expect(r(input).text).toBe(input);
    },
  );
});

describe('secrets', () => {
  const gh36 = 'a'.repeat(20) + 'B1'.repeat(8);

  it.each([
    ['ghp', `token ghp_${gh36}`],
    ['gho', `gho_${gh36}`],
    ['ghu', `ghu_${gh36}`],
    ['ghs', `ghs_${gh36}`],
    ['ghr', `ghr_${gh36}`],
    ['fine-grained PAT', `github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz`],
    ['slack', 'xoxb-1234567890-abcdefghijkl'],
    ['aws', 'AKIAABCDEFGHIJKLMNOP'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ])('redacts a %s token', (_name, input) => {
    const out = r(input);
    expect(out.text).toContain('[redacted-secret]');
    expect(out.counts.secret).toBe(1);
  });

  it('keeps the header name and scheme on Authorization headers', () => {
    expect(r('Authorization: Bearer abc.def-123').text).toBe('Authorization: Bearer [redacted-secret]');
    expect(r('-H "Authorization: Basic dXNlcjpwYXNz"').text).toBe('-H "Authorization: Basic [redacted-secret]"');
  });

  it('redacts a bare long bearer token but not the word bearer in prose', () => {
    expect(r('Bearer abcdefghijklmnopqrstuvwxyz0123').text).toBe('Bearer [redacted-secret]');
    expect(r('Bearer tokens expire').text).toBe('Bearer tokens expire');
  });

  it('replaces only the userinfo of a URL with credentials', () => {
    expect(r('https://svc:hunter2@artifactory.imagile.dev/api').text).toBe(
      'https://[redacted-secret]@artifactory.imagile.dev/api',
    );
    expect(r('https://git@github.com/x').text).toBe('https://git@github.com/x');
  });

  it('redacts credentials and the host in the same URL', () => {
    expect(r('https://u:p@jira.acme-int.net/').text).toBe('https://[redacted-secret]@jira.imagile.dev/');
  });

  it('does not flag short or look-alike strings', () => {
    expect(r('ghp_short').text).toBe('ghp_short');
    expect(r('AKIA123').text).toBe('AKIA123');
  });
});

describe('emails', () => {
  it('drops the whole address at a denylisted domain or subdomain, not just the domain', () => {
    expect(r('ask jane.doe@acme-int.net or ops+alerts@mail.acme-int.net').text)
      .toBe('ask [redacted-email] or [redacted-email]');
    expect(r('write to it-help@corp-mail.hq.corp').text).toBe('write to [redacted-email]');
  });

  it('leaves ordinary and placeholder addresses alone', () => {
    const text = 'reply to you@example.com or jane@gmail.com';
    expect(r(text).text).toBe(text);
  });
});

describe('more credential formats', () => {
  it.each([
    ['Atlassian', 'ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Bitbucket DC', 'BBDC-MTIzNDU2Nzg5MDEyOmFiY2RlZmdoaWprbG1u'],
    ['GitLab', 'glpat-abcdefghijklmnopqrst12'],
    ['npm', 'npm_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['Anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['OpenAI', 'sk-proj-abcdefghijklmnopqrstuvwxyz'],
  ])('redacts a %s token', (_name, token) => {
    expect(r(`token here: ${token} end`).text).toBe('token here: [redacted-secret] end');
  });

  it('redacts a PEM private key block whole', () => {
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----';
    expect(r(`key:\n${pem}\ndone`).text).toBe('key:\n[redacted-secret]\ndone');
  });

  it('redacts secret values in key=value and JSON pairs, keeping the key', () => {
    expect(r('PASSWORD=Sup3rS3cretValue').text).toBe('PASSWORD=[redacted-secret]');
    expect(r('{ "token": "abc123def456ghi789" }').text).toBe('{ "token": "[redacted-secret]" }');
    expect(r("api_key: 'a1b2c3d4e5f6'").text).toBe("api_key: '[redacted-secret]'");
  });

  it('keeps references that are not secrets', () => {
    for (const text of [
      '"token": "keychain:github.token"',
      'token: ${{ secrets.GITHUB_TOKEN }}',
      'password=<your-password>',
      'token = process.env.GITHUB_TOKEN',
      'pat: ***',
      'tokenSource: fallback-value',
      'the password is short',
    ]) expect(r(text).text).toBe(text);
  });
});

describe('no false positives', () => {
  it.each([
    'pncli',
    'npm i -g @kolatts/pncli',
    'https://github.com/kolatts/pncli/issues/1',
    'https://jira.imagile.dev/rest/api/2',
    'you@example.com',
    'PNCLI_JIRA_BASE_URL',
    'Version 5.3.0 released',
  ])('leaves %j unchanged', (input) => {
    const out = r(input);
    expect(out.text).toBe(input);
    expect(Object.values(out.counts).every((c) => c === 0)).toBe(true);
  });

  it('touches only the matches inside fenced code', () => {
    const input = '```json\n{ "baseUrl": "https://jira.acme-int.net", "user": "me" }\n```';
    expect(r(input).text).toBe('```json\n{ "baseUrl": "https://jira.imagile.dev", "user": "me" }\n```');
  });
});

describe('idempotency', () => {
  const sample = [
    'At AcmeBank (ACM) we run https://svc:pw@jira.acme-int.net and sonar.initech.io.',
    'Internal: http://jenkins.build.corp, 10.20.30.40, 192.168.0.1.',
    `Token ghp_${'x'.repeat(36)} and Authorization: Bearer abcdefghijklmnopqrstuvwxyz.`,
    'Email ops@mail.acme-int.net, AWS AKIAABCDEFGHIJKLMNOP, Bearer abcdefghijklmnopqrstuvwxyz0123',
  ].join('\n');

  it('is a fixed point for emails and the new credential formats', () => {
    const once = r('jane@acme-int.net PASSWORD=Sup3rS3cretValue glpat-abcdefghijklmnopqrst12').text;
    const twice = redact(once, TERMS);
    expect(twice.text).toBe(once);
    expect(Object.values(twice.counts).every((c) => c === 0)).toBe(true);
  });

  it('is a fixed point', () => {
    const once = r(sample);
    expect(Object.values(once.counts).some((c) => c > 0)).toBe(true);
    const twice = r(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.counts).toEqual({ org: 0, domain: 0, internalHost: 0, privateIp: 0, secret: 0 });
  });

  it('is a fixed point for regex terms', () => {
    const t = parseTerms('re:/acme[- ]?corp/i');
    const once = redact('Acme Corp', t);
    expect(redact(once.text, t).counts.org).toBe(0);
  });
});

describe('empty terms', () => {
  it('still applies the built-in rules', () => {
    const none = parseTerms('');
    const out = redact('AcmeBank at db.prod.internal 10.0.0.1 AKIAABCDEFGHIJKLMNOP', none);
    expect(out.text).toBe('AcmeBank at redacted.imagile.dev [redacted-ip] [redacted-secret]');
    expect(out.counts).toEqual({ org: 0, domain: 0, internalHost: 1, privateIp: 1, secret: 1 });
  });

  it('works with no terms argument at all', () => {
    expect(redact('10.0.0.1').text).toBe('[redacted-ip]');
  });

  it('returns empty text for null, undefined, and empty input', () => {
    expect(redact('', TERMS).text).toBe('');
    expect(redact(null, TERMS).text).toBe('');
    expect(redact(undefined, TERMS).text).toBe('');
  });
});

describe('redactIssue', () => {
  it('redacts title and body and sums the counts', () => {
    const out = redactIssue({ title: 'Bug at ACM', body: 'see jira.acme-int.net' }, TERMS);
    expect(out).toEqual({
      title: 'Bug at [org]',
      body: 'see jira.imagile.dev',
      changed: true,
      counts: { org: 1, domain: 1, internalHost: 0, privateIp: 0, secret: 0 },
    });
  });

  it('reports unchanged content and keeps a null body null', () => {
    const out = redactIssue({ title: 'All fine', body: null }, TERMS);
    expect(out.changed).toBe(false);
    expect(out.body).toBeNull();
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./redact.mjs', import.meta.url));

  it('reads JSON on stdin, terms from env, and never echoes the terms', () => {
    const stdout = execFileSync(process.execPath, [script], {
      input: JSON.stringify({ title: 'acmebank outage', body: 'https://jira.acme-int.net' }),
      env: { ...process.env, REDACT_TERMS: 'acmebank\nacme-int.net\nre:/([/' },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = JSON.parse(stdout);
    expect(out.title).toBe('[org] outage');
    expect(out.body).toBe('https://jira.imagile.dev');
    expect(out.changed).toBe(true);
    expect(stdout).not.toContain('acme');
  });

  it('fails without echoing malformed input', () => {
    let stderr = '';
    try {
      execFileSync(process.execPath, [script], {
        input: 'not json acmebank',
        env: { ...process.env, REDACT_TERMS: 'acmebank' },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      stderr = String(err.stderr);
    }
    expect(stderr).toContain('redact: failed');
    expect(stderr).not.toContain('acmebank');
  });
});

describe('review follow-ups (#504)', () => {
  it('redacts pncli env vars and other prefixed keys by their suffix', () => {
    expect(r('PNCLI_JIRA_API_TOKEN=NjE2ODg4MDk1MzQ3OmRldmVsb3Blcg').text).toBe('PNCLI_JIRA_API_TOKEN=[redacted-secret]');
    expect(r('export PNCLI_BITBUCKET_PAT="BBZdmVsb3Blcjo5ODc2NTQzMjE"').text).toBe('export PNCLI_BITBUCKET_PAT="[redacted-secret]"');
    expect(r('JIRA_TOKEN=abcdef1234567890').text).toBe('JIRA_TOKEN=[redacted-secret]');
    expect(r('PNCLI_SONATYPEIQ_PASSCODE=qwertyuiop123').text).toBe('PNCLI_SONATYPEIQ_PASSCODE=[redacted-secret]');
  });

  it('redacts camelCase keys from pncli config.json', () => {
    for (const key of ['apiToken', 'clientSecret', 'refreshToken', 'platformToken', 'adminApiKey', 'serviceKey']) {
      expect(r(`{ "${key}": "NjE2ODg4MDk1MzQ3" }`).text, key).toBe(`{ "${key}": "[redacted-secret]" }`);
    }
  });

  it('leaves non-secret keys that merely contain a secret word alone', () => {
    for (const text of ['"tokenSource": "fallback-value"', 'JIRA_TOKEN_URL=https://jira.imagile.dev/x', '"primaryKey": "user_id_abcdefgh"', 'patch=abcdefghijk'])
      expect(r(text).text, text).toBe(text);
  });

  it('redacts SonarQube and Dynatrace tokens by prefix', () => {
    expect(r('squ_0123456789abcdef0123456789abcdef01234567 ok').text).toBe('[redacted-secret] ok');
    expect(r('dt0c01.ABCDEFGHIJKLMNOPQRSTUVWX.' + 'A'.repeat(64)).text).toBe('[redacted-secret]');
  });

  it('drops an address whose host contains a word-only term', () => {
    const words = parseTerms('acmebank');
    expect(redact('mail jane.doe@acmebank.com or ops@it.acmebank.co.uk', words).text).toBe('mail [redacted-email] or [redacted-email]');
    expect(redact('git@acmebank.com:team/repo.git', words).text).toBe('git@[org].com:team/repo.git');
    const re = parseTerms('re:/acme[- ]?corp/i');
    expect(redact('bob@acme-corp.io', re).text).toBe('[redacted-email]');
  });

  it('only exempts git@ as an SSH user; other user IDs are dropped', () => {
    expect(r('ssh://jdoe@bitbucket.acme-int.net:7999/proj/repo.git').text).toBe('ssh://[redacted-email]:7999/proj/repo.git');
    expect(r('Contact: jane.doe@acme-int.net: thanks').text).toBe('Contact: [redacted-email]: thanks');
    expect(r('ssh://git@bitbucket.acme-int.net:7999/proj/repo.git').text).toBe('ssh://git@bitbucket.imagile.dev:7999/proj/repo.git');
  });

  it('rejects terms that collide with the redactor\'s own markers, keeping reruns stable', () => {
    const t = parseTerms('org\ndev\nsecret\njira\nimagile.dev\nacmebank');
    expect(t.words).toEqual(['acmebank']);
    expect(t.domains).toEqual([]);
    expect(t.invalid).toBe(5);
    const once = redact('acmebank [org] jira.imagile.dev', t).text;
    expect(redact(once, t).text).toBe(once);
  });

  it('does not treat version strings as private IPs', () => {
    for (const text of ['upgraded to v10.0.0.1', 'version 10.0.0.0', 'Version: 10.0.0.0', 'npm i pkg@10.0.0.4'])
      expect(r(text).text, text).toBe(text);
    expect(r('host at 10.0.0.12 was down').text).toBe('host at [redacted-ip] was down');
  });
});
