import type { ResolvedConfig } from '../types/config.js';
import { PncliError } from './errors.js';
import { ExitCode } from './exitCodes.js';
import { log } from './output.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface HttpRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(url, init, timeoutMs);
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
        // errors as array of objects with message field (other APIs)
        if (Array.isArray(parsed.errors)) {
          for (const e of parsed.errors as Array<{ message?: string }>) {
            if (e?.message) parts.push(e.message);
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

    return response.json() as Promise<T>;
  }

  throw lastError ?? new PncliError('Request failed after retries', 1, url);
}

export class HttpClient {
  private config: ResolvedConfig;
  private dryRun: boolean;

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
      process.stderr.write(msg, () => process.exit(ExitCode.SUCCESS));
      return new Promise<never>(() => { /* exit pending */ });
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
      process.stderr.write(msg, () => process.exit(ExitCode.SUCCESS));
      return new Promise<never>(() => { /* exit pending */ });
    }

    return request<T>(url, init, opts.timeoutMs ?? 30000);
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
