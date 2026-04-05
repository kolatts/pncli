export interface Meta {
  service: string;
  action: string;
  timestamp: string;
  duration_ms: number;
  user?: {
    email: string | undefined;
    userId: string | undefined;
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
