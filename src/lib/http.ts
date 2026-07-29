import fs from 'fs';
import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';
import { ExitCode } from './exitCodes.js';
import { log, debug, isDebugEnabled } from './output.js';
import { buildAdoFetcher } from './adoFetch.js';
import { buildCheckmarxFetcher } from './checkmarxFetch.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HttpRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface HttpError {
  error: true;
  status: number;
  message: string;
  url: string;
}

const SENSITIVE_HEADERS = new Set(['authorization', 'api-key']);

function redactHeaders(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  let entries: [string, string][];
  if (headers instanceof Headers) {
    entries = [...headers.entries()];
  } else if (Array.isArray(headers)) {
    entries = (headers as string[][]) as [string, string][];
  } else {
    entries = Object.entries(headers as Record<string, string>);
  }
  return Object.fromEntries(
    entries.map(([k, v]) => [k, SENSITIVE_HEADERS.has(k.toLowerCase()) ? '[REDACTED]' : v])
  );
}

function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const normalizedBase = base.endsWith('/') ? base : base + '/';
  // Strip a leading '/' so that new URL(path, base) resolves relative to base's full
  // path rather than the origin. Per the WHATWG URL spec, an absolute-path reference
  // (starting with '/') resolves against the origin and discards any path already
  // present in base — which silently drops path segments like '/e/<environment-id>'
  // from Dynatrace Managed or Artifactory-with-context-root base URLs.
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) {
        url.searchParams.set(key, String(val));
      }
    }
  }
  return url.toString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetcher: typeof fetch = fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetcher: typeof fetch = fetch
): Promise<T> {
  let lastError: unknown;

  if (isDebugEnabled()) {
    const method = (init.method ?? 'GET').toUpperCase();
    const safeHeaders = redactHeaders(init.headers);
    debug(`→ ${method} ${url}`);
    debug(`  Headers: ${JSON.stringify(safeHeaders)}`);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    const reqStart = Date.now();
    try {
      response = await fetchWithTimeout(url, init, timeoutMs, fetcher);
    } catch (err) {
      debug(`  Error: ${err instanceof Error ? err.message : String(err)}`);
      throw new PncliError(
        `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        url
      );
    }

    debug(`← ${response.status} ${response.statusText} (${Date.now() - reqStart}ms)`);

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (attempt + 1) * 1000;
      log(`Rate limited. Retrying after ${waitMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      lastError = new PncliError('Rate limited', 429, url);
      continue;
    }

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const body = await response.text();
        const parsed = JSON.parse(body);
        const parts: string[] = [];
        // Jira: errorMessages is string[]
        if (Array.isArray(parsed.errorMessages)) {
          parts.push(...(parsed.errorMessages as string[]).filter(Boolean));
        }
        // errors as object map (Jira: Record<string, string>)
        if (parsed.errors && typeof parsed.errors === 'object' && !Array.isArray(parsed.errors)) {
          for (const [field, msg] of Object.entries(parsed.errors as Record<string, string>)) {
            parts.push(`${field}: ${msg}`);
          }
        }
        // errors as array of objects with message or msg field (SonarQube uses msg)
        if (Array.isArray(parsed.errors)) {
          for (const e of parsed.errors as Array<{ message?: string; msg?: string }>) {
            if (e?.message) parts.push(e.message);
            else if (e?.msg) parts.push(e.msg);
          }
        }
        // Generic APIs: { message: "..." }
        if (parts.length === 0 && parsed.message) {
          parts.push(String(parsed.message));
        }
        if (parts.length > 0) message = parts.join('; ');
      } catch {
        // ignore parse errors
      }
      throw new PncliError(message, response.status, url);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  throw lastError ?? new PncliError('Request failed after retries', 1, url);
}

export class HttpClient {
  private config: ResolvedConfig;
  private dryRun: boolean;
  private adoFetcher: typeof fetch | null = null;
  private checkmarxFetcher: typeof fetch | null = null;

  constructor(config: ResolvedConfig, dryRun = false) {
    this.config = config;
    this.dryRun = dryRun;
  }

  private jiraToken(): string {
    const { apiToken } = this.config.jira;
    if (!apiToken) throw new PncliError('Jira credentials not configured. Run: pncli config init');
    return apiToken;
  }

  private jiraHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.jiraToken()}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  private bitbucketHeaders(): Record<string, string> {
    const { pat } = this.config.bitbucket;
    if (!pat) throw new PncliError('Bitbucket credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  private githubHeaders(): Record<string, string> {
    const { token } = this.config.github;
    if (!token) throw new PncliError('GitHub credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Connection': 'close'
    };
  }

  async jira<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.jira.baseUrl;
    if (!baseUrl) throw new PncliError('Jira baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.jiraHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async jiraBuffer(absoluteUrl: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.jiraToken()}`,
      'Connection': 'close'
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: GET ${absoluteUrl}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`;
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const response = await fetchWithTimeout(absoluteUrl, { headers }, opts.timeoutMs ?? 60000);
    if (!response.ok) {
      throw new PncliError(`HTTP ${response.status} ${response.statusText}`, response.status, absoluteUrl);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async adoUpload<T>(
    path: string,
    buffer: Buffer,
    contentType: string,
    opts: { timeoutMs?: number } = {}
  ): Promise<T> {
    const baseUrl = this.config.ado.baseUrl;
    if (!baseUrl) throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path);

    if (this.dryRun) {
      fs.writeSync(process.stderr.fd, `DRY RUN: POST ${url}\nBody: <binary ${buffer.length} bytes>\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = await this.getAdoFetcher();
    return request<T>(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': contentType },
      body: buffer
    }, opts.timeoutMs ?? 60000, fetcher);
  }

  async adoBuffer(absoluteUrl: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
    if (this.dryRun) {
      fs.writeSync(process.stderr.fd, `DRY RUN: GET ${absoluteUrl}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = await this.getAdoFetcher();
    const response = await fetchWithTimeout(
      absoluteUrl,
      { headers: { Accept: 'application/octet-stream' } },
      opts.timeoutMs ?? 60000,
      fetcher
    );
    if (!response.ok) {
      throw new PncliError(`HTTP ${response.status} ${response.statusText}`, response.status, absoluteUrl);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async jiraUpload<T>(
    path: string,
    formData: FormData,
    opts: { timeoutMs?: number } = {}
  ): Promise<T> {
    const baseUrl = this.config.jira.baseUrl;
    if (!baseUrl) throw new PncliError('Jira baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.jiraToken()}`,
      'X-Atlassian-Token': 'no-check',
      'Accept': 'application/json',
      'Connection': 'close'
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: POST ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\nBody: <multipart/form-data>\n`;
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, { method: 'POST', headers, body: formData }, opts.timeoutMs ?? 60000);
  }

  async github<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.github.baseUrl;
    if (!baseUrl) throw new PncliError('GitHub baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.githubHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async githubText(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<string> {
    const baseUrl = this.config.github.baseUrl;
    if (!baseUrl) throw new PncliError('GitHub baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    // Reuse githubHeaders() (which enforces the token check) and override Accept so
    // GitHub returns the raw unified diff instead of JSON.
    const headers: Record<string, string> = {
      ...this.githubHeaders(),
      'Accept': 'application/vnd.github.v3.diff'
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      fs.writeSync(process.stderr.fd, `DRY RUN: ${opts.method ?? 'GET'} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const response = await fetchWithTimeout(url, {
      method: opts.method ?? 'GET',
      headers
    }, opts.timeoutMs ?? 30000);

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    return response.text();
  }

  async githubPaginate<T>(
    fetchPage: (page: number, perPage: number) => Promise<T[]>
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const items = await fetchPage(page, perPage);
      results.push(...items);
      if (items.length < perPage) break;
      page++;
    }

    return results;
  }

  async bitbucket<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.bitbucket.baseUrl;
    if (!baseUrl) throw new PncliError('Bitbucket baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.bitbucketHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private confluenceToken(): string {
    const { apiToken } = this.config.confluence;
    if (!apiToken) throw new PncliError('Confluence credentials not configured. Run: pncli config init');
    return apiToken;
  }

  private confluenceHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.confluenceToken()}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async confluence<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.confluence.baseUrl;
    if (!baseUrl) throw new PncliError('Confluence baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.confluenceHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private sdeHeaders(): Record<string, string> {
    const { token } = this.config.sde;
    if (!token) throw new PncliError('SDElements credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async sde<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.sde.baseUrl;
    if (!baseUrl) throw new PncliError('SDElements baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.sdeHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async sdePaginate<T>(
    fetchPage: (page: number, pageSize: number) => Promise<{ count: number; results: T[] }>
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    const pageSize = 100;

    while (true) {
      const response = await fetchPage(page, pageSize);
      results.push(...response.results);
      if (results.length >= response.count || response.results.length === 0) break;
      page++;
    }

    return results;
  }

  private async getAdoFetcher(): Promise<typeof fetch> {
    if (!this.adoFetcher) {
      this.adoFetcher = await buildAdoFetcher(this.config);
    }
    return this.adoFetcher;
  }

  async ado<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.ado.baseUrl;
    if (!baseUrl) throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);

    if (this.dryRun) {
      const msg = `DRY RUN: ${opts.method ?? 'GET'} ${url}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = await this.getAdoFetcher();
    const defaultHeaders: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...opts.headers
    };
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: defaultHeaders,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    return request<T>(url, init, opts.timeoutMs ?? 30000, fetcher);
  }

  async adoText(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<string> {
    const baseUrl = this.config.ado.baseUrl;
    if (!baseUrl) throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);

    if (this.dryRun) {
      fs.writeSync(process.stderr.fd, `DRY RUN: ${opts.method ?? 'GET'} ${url}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = await this.getAdoFetcher();
    const response = await fetchWithTimeout(url, {
      method: opts.method ?? 'GET',
      headers: { 'Accept': 'text/plain', ...opts.headers }
    }, opts.timeoutMs ?? 30000, fetcher);

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    return response.text();
  }

  async adoRaw(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<{ data: unknown; headers: Headers }> {
    const baseUrl = this.config.ado.baseUrl;
    if (!baseUrl) throw new PncliError('Azure DevOps baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);

    if (this.dryRun) {
      fs.writeSync(process.stderr.fd, `DRY RUN: ${opts.method ?? 'GET'} ${url}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = await this.getAdoFetcher();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: opts.method ?? 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    return { data, headers: response.headers };
  }

  async adoPaginate<T>(
    fetchPage: (continuationToken?: string) => Promise<{ data: { value: T[] }; headers: Headers }>
  ): Promise<T[]> {
    const results: T[] = [];
    let token: string | undefined;

    while (true) {
      const { data, headers } = await fetchPage(token);
      results.push(...(data.value ?? []));
      const next = headers.get('x-ms-continuationtoken');
      if (!next) break;
      token = next;
    }

    return results;
  }

  private jenkinsHeaders(): Record<string, string> {
    const { username, apiToken } = this.config.jenkins;
    if (!username || !apiToken) throw new PncliError('Jenkins credentials not configured. Run: pncli config init');
    const creds = Buffer.from(`${username}:${apiToken}`).toString('base64');
    return {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  private artifactoryHeaders(): Record<string, string> {
    const { token } = this.config.artifactory;
    if (!token) throw new PncliError('Artifactory credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  private udeployHeaders(): Record<string, string> {
    const { pat, username, password } = this.config.udeploy;
    let encoded: string;
    if (username && password) {
      encoded = Buffer.from(`${username}:${password}`).toString('base64');
    } else if (username && pat) {
      encoded = Buffer.from(`${username}:${pat}`).toString('base64');
    } else if (pat) {
      encoded = Buffer.from(`PasswordIsAuthToken:${JSON.stringify({ token: pat })}`).toString('base64');
    } else {
      throw new PncliError('UDeploy credentials not configured. Run: pncli config init');
    }
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async jenkins<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.jenkins.baseUrl;
    if (!baseUrl) throw new PncliError('Jenkins baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.jenkinsHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async jenkinsRaw(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<{ status: number; headers: Headers; text: string }> {
    const baseUrl = this.config.jenkins.baseUrl;
    if (!baseUrl) throw new PncliError('Jenkins baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.jenkinsHeaders();

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${opts.method ?? 'GET'} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const response = await fetchWithTimeout(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }, opts.timeoutMs ?? 30000);

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    return { status: response.status, headers: response.headers, text: await response.text() };
  }

  async artifactory<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.artifactory.baseUrl;
    if (!baseUrl) throw new PncliError('Artifactory baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = { ...this.artifactoryHeaders(), ...opts.headers };

    // AQL search uses text/plain body — don't JSON-serialize it
    const body = opts.body !== undefined
      ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      : undefined;

    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }


  async udeploy<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.udeploy.baseUrl;
    if (!baseUrl) throw new PncliError('UDeploy baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.udeployHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async artifactoryText(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<string> {
    const baseUrl = this.config.artifactory.baseUrl;
    if (!baseUrl) throw new PncliError('Artifactory baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = { ...this.artifactoryHeaders(), Accept: 'text/plain', ...opts.headers };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      fs.writeSync(process.stderr.fd, `DRY RUN: ${opts.method ?? 'GET'} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const response = await fetchWithTimeout(url, {
      method: opts.method ?? 'GET',
      headers
    }, opts.timeoutMs ?? 30000);

    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    return response.text();
  }



  private sonarHeaders(): Record<string, string> {
    const { token } = this.config.sonar;
    if (!token) throw new PncliError('SonarQube credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async sonar<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.sonar.baseUrl;
    if (!baseUrl) throw new PncliError('SonarQube baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.sonarHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async sonarPaginate<T>(
    fetchPage: (page: number, pageSize: number) => Promise<{ total: number; p: number; ps: number; items: T[] }>
  ): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    const pageSize = 500;

    while (true) {
      const response = await fetchPage(page, pageSize);
      results.push(...response.items);
      if (results.length >= response.total || response.items.length === 0) break;
      page++;
    }

    return results;
  }

  async confluenceUpload<T>(
    path: string,
    formData: FormData,
    opts: { timeoutMs?: number } = {}
  ): Promise<T> {
    const baseUrl = this.config.confluence.baseUrl;
    if (!baseUrl) throw new PncliError('Confluence baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.confluenceToken()}`,
      'X-Atlassian-Token': 'no-check',
      'Accept': 'application/json',
      'Connection': 'close'
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: POST ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\nBody: <multipart/form-data>\n`;
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, { method: 'POST', headers, body: formData }, opts.timeoutMs ?? 60000);
  }

  async confluencePaginate<T>(
    fetchPage: (start: number, limit: number) => Promise<{ results: T[]; start: number; limit: number; size: number; _links: { next?: string } }>,
    maxTotal?: number
  ): Promise<T[]> {
    const results: T[] = [];
    let start = 0;
    const defaultPageSize = 25;

    while (true) {
      const pageLimit = maxTotal !== undefined
        ? Math.min(maxTotal - results.length, defaultPageSize)
        : defaultPageSize;
      const page = await fetchPage(start, pageLimit);
      results.push(...page.results);
      if (maxTotal !== undefined && results.length >= maxTotal) break;
      if (!page._links.next) break;
      start += page.size;
    }

    return maxTotal !== undefined ? results.slice(0, maxTotal) : results;
  }

  async paginate<T>(
    fetchPage: (start: number, limit: number) => Promise<{ values: T[]; isLastPage: boolean; nextPageStart?: number }>
  ): Promise<T[]> {
    const results: T[] = [];
    let start = 0;
    const limit = 100;

    while (true) {
      const page = await fetchPage(start, limit);
      results.push(...page.values);
      if (page.isLastPage) break;
      start = page.nextPageStart ?? start + limit;
    }

    return results;
  }

  async jiraPaginate<T>(
    fetchPage: (startAt: number, maxResults: number) => Promise<{ issues?: T[]; values?: T[]; total: number; startAt: number; maxResults: number }>
  ): Promise<T[]> {
    const results: T[] = [];
    let startAt = 0;
    const maxResults = 100;

    while (true) {
      const page = await fetchPage(startAt, maxResults);
      const items = (page.issues ?? page.values ?? []) as T[];
      results.push(...items);
      startAt += items.length;
      if (startAt >= page.total || items.length === 0) break;
    }

    return results;
  }

  private getCheckmarxFetcher(): typeof fetch {
    if (!this.checkmarxFetcher) {
      this.checkmarxFetcher = buildCheckmarxFetcher(this.config);
    }
    return this.checkmarxFetcher;
  }

  private servicenowHeaders(): Record<string, string> {
    const { username, password, apiToken } = this.config.servicenow;
    let encoded: string;
    if (username && apiToken) {
      encoded = Buffer.from(`${username}:${apiToken}`).toString('base64');
    } else if (username && password) {
      encoded = Buffer.from(`${username}:${password}`).toString('base64');
    } else {
      throw new PncliError('ServiceNow credentials not configured. Run: pncli config init');
    }
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async servicenow<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.servicenow.baseUrl;
    if (!baseUrl) throw new PncliError('ServiceNow baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.servicenowHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private contrastHeaders(): Record<string, string> {
    const { apiKey, serviceKey, username } = this.config.contrast;
    if (!apiKey || !serviceKey || !username) {
      throw new PncliError('Contrast credentials not configured. Run: pncli config init');
    }
    const authorization = Buffer.from(`${username}:${serviceKey}`).toString('base64');
    return {
      'Authorization': authorization,
      'API-Key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async contrast<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const { baseUrl } = this.config.contrast;
    if (!baseUrl) throw new PncliError('Contrast base URL not configured. Run: pncli config set contrast.baseUrl <url>');


    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.contrastHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]', 'API-Key': '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private sonatypeiqHeaders(): Record<string, string> {
    const { userCode, passcode } = this.config.sonatypeiq;
    if (!userCode || !passcode) throw new PncliError('Sonatype IQ credentials not configured. Run: pncli config init');
    const encoded = Buffer.from(`${userCode}:${passcode}`).toString('base64');
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async sonatypeiq<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.sonatypeiq.baseUrl;
    if (!baseUrl) throw new PncliError('Sonatype IQ Server baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.sonatypeiqHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private openshiftHeaders(): Record<string, string> {
    const { token } = this.config.openshift;
    if (!token) throw new PncliError('OpenShift credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async openshift<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.openshift.baseUrl;
    if (!baseUrl) throw new PncliError('OpenShift baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.openshiftHeaders();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  private dynatraceHeaders(platform = false): Record<string, string> {
    const token = platform ? this.config.dynatrace.platformToken : this.config.dynatrace.apiToken;
    if (!token) {
      throw new PncliError(
        `${platform ? 'Dynatrace platform' : 'Dynatrace'} credentials not configured. Run: pncli config init`
      );
    }
    return {
      'Authorization': `${platform ? 'Bearer' : 'Api-Token'} ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async dynatrace<T>(path: string, opts: HttpRequestOptions = {}): Promise<T> {
    return this.dynatraceRequest<T>(false, path, opts);
  }

  async dynatracePlatform<T>(path: string, opts: HttpRequestOptions = {}): Promise<T> {
    return this.dynatraceRequest<T>(true, path, opts);
  }

  private async dynatraceRequest<T>(
    platform: boolean,
    path: string,
    opts: HttpRequestOptions
  ): Promise<T> {
    const baseUrl = platform ? this.config.dynatrace.platformUrl : this.config.dynatrace.baseUrl;
    if (!baseUrl) {
      throw new PncliError(
        `${platform ? 'Dynatrace platformUrl' : 'Dynatrace baseUrl'} not configured. Run: pncli config init`
      );
    }
    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.dynatraceHeaders(platform);
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };
    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      const msg = `DRY RUN: ${init.method} ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }
    return request<T>(url, init, opts.timeoutMs ?? 30000);
  }

  async openshiftText(
    path: string,
    opts: HttpRequestOptions & { lines?: number } = {}
  ): Promise<string> {
    const baseUrl = this.config.openshift.baseUrl;
    if (!baseUrl) throw new PncliError('OpenShift baseUrl not configured. Run: pncli config init');

    const params: Record<string, string | number | boolean | undefined> = { ...opts.params };
    if (opts.lines !== undefined) params['tailLines'] = opts.lines;

    const url = buildUrl(baseUrl, path, params);
    const headers: Record<string, string> = {
      'Authorization': this.openshiftHeaders()['Authorization'],
      'Accept': '*/*',
      'Connection': 'close'
    };

    if (this.dryRun) {
      const safeHeaders = { ...headers, Authorization: '[REDACTED]' };
      fs.writeSync(process.stderr.fd, `DRY RUN: GET ${url}\nHeaders: ${JSON.stringify(safeHeaders, null, 2)}\n`);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const response = await fetchWithTimeout(url, { method: 'GET', headers }, opts.timeoutMs ?? 30000);
    if (!response.ok) {
      let message = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed.message) message = String(parsed.message);
      } catch { /* ignore */ }
      throw new PncliError(message, response.status, url);
    }

    return response.text();
  }

  async checkmarx<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.checkmarx.baseUrl;
    if (!baseUrl) throw new PncliError('Checkmarx baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);

    if (this.dryRun) {
      const msg = `DRY RUN: ${opts.method ?? 'GET'} ${url}\n`
        + (opts.body ? `Body: ${JSON.stringify(opts.body, null, 2)}\n` : '');
      fs.writeSync(process.stderr.fd, msg);
      process.exitCode = ExitCode.SUCCESS;
      throw new PncliError('dry-run', 0);
    }

    const fetcher = this.getCheckmarxFetcher();
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    };

    return request<T>(url, init, opts.timeoutMs ?? 30000, fetcher);
  }
}

export function createHttpClient(config: ResolvedConfig, dryRun = false): HttpClient {
  return new HttpClient(config, dryRun);
}
