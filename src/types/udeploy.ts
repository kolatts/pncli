export interface UdeployApplication {
  id: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface UdeployEnvironment {
  id: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface UdeployComponent {
  id: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface UdeployVersion {
  id: string;
  name: string;
  created: number;
  active: boolean;
  status?: string;
}

export interface UdeployVersionCreateResult {
  id: string;
  name: string;
  component: { id: string; name: string };
}

export interface UdeployProcessRequest {
  requestId: string;
}

export interface UdeployRequestStatus {
  status: 'EXECUTING' | 'CLOSED' | string;
  result?: 'SUCCEEDED' | 'FAULTED' | 'CANCELED' | string;
}

export interface UdeployRequestInfo {
  id: string;
  application: { id: string; name: string };
  environment: { id: string; name: string };
  applicationProcess: { id: string; name: string };
  startTime?: number;
  result?: string;
  status: string;
}
