export interface Meta {
  service: string;
  action: string;
  timestamp: string;
  duration_ms: number;
  user?: {
    email: string | undefined;
    userId: string | undefined;
  };
  /** Field names where a CLI flag overrode the same key supplied via --input-file. */
  overrides?: string[];
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  meta: Meta;
}

export interface ErrorDetail {
  status: number;
  message: string;
  url: string | null;
  /** Seconds the server asked us to wait, present on a 429 whose Retry-After exceeded the retry cap. */
  retryAfterSeconds?: number;
}

export interface ErrorEnvelope {
  ok: false;
  error: ErrorDetail;
  meta: Meta;
}

export type OutputEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export interface GlobalOptions {
  pretty: boolean;
  verbose: boolean;
  dryRun: boolean;
  config?: string;
}
