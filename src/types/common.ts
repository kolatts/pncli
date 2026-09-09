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
  /** Result coverage for a paginated/filtered listing, when the command can report it — lets callers judge whether the returned set actually spans the window they expected instead of trusting a bare "success". */
  coverage?: {
    count: number;
    oldestDate: string | null;
    newestDate: string | null;
    status: string;
  };
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
