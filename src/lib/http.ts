import fs from 'fs';
import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';
import { ExitCode } from './exitCodes.js';
import { log } from './output.js';
import { buildAdoFetcher } from './adoFetch.js';

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

function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(path, base.endsWith('/') ? base : base + '/');
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

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, init, timeoutMs, fetcher);
    } catch (err) {
      throw new PncliError(
        `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        url
      );
    }

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

  constructor(config: ResolvedConfig, dryRun = false) {
    this.config = config;
    this.dryRun = dryRun;
  }

  private jiraHeaders(): Record<string, string> {
    const { apiToken } = this.config.jira;
    if (!apiToken) throw new PncliError('Jira credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${apiToken}`,
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

  private confluenceHeaders(): Record<string, string> {
    const { apiToken } = this.config.confluence;
    if (!apiToken) throw new PncliError('Confluence credentials not configured. Run: pncli config init');
    return {
      'Authorization': `Bearer ${apiToken}`,
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

  private sonatypeHeaders(): Record<string, string> {
    const { username, password } = this.config.sonatype;
    if (!username || !password) throw new PncliError('Sonatype credentials not configured. Run: pncli config init');
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'close'
    };
  }

  async sonatype<T>(
    path: string,
    opts: HttpRequestOptions = {}
  ): Promise<T> {
    const baseUrl = this.config.sonatype.baseUrl;
    if (!baseUrl) throw new PncliError('Sonatype baseUrl not configured. Run: pncli config init');

    const url = buildUrl(baseUrl, path, opts.params);
    const headers = this.sonatypeHeaders();
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

  async confluencePaginate<T>(
    fetchPage: (start: number, limit: number) => Promise<{ results: T[]; start: number; limit: number; size: number; _links: { next?: string } }>
  ): Promise<T[]> {
    const results: T[] = [];
    let start = 0;
    const limit = 25;

    while (true) {
      const page = await fetchPage(start, limit);
      results.push(...page.results);
      if (!page._links.next) break;
      start += page.size;
    }

    return results;
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
}

export function createHttpClient(config: ResolvedConfig, dryRun = false): HttpClient {
  return new HttpClient(config, dryRun);
}
