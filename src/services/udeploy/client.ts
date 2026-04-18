import type { HttpClient } from '../../lib/http.js';
import type {
  UdeployApplication,
  UdeployComponent,
  UdeployEnvironment,
  UdeployProcessRequest,
  UdeployRequestInfo,
  UdeployRequestStatus,
  UdeployVersion,
  UdeployVersionCreateResult,
} from '../../types/udeploy.js';

export interface UdeployRunProcessOptions {
  application: string;
  applicationProcess: string;
  environment: string;
  onlyChanged?: boolean;
  versions?: Array<{ component: string; version: string }>;
  snapshot?: string;
  properties?: Record<string, string>;
}

export class UdeployClient {
  constructor(private http: HttpClient) {}

  listApplications(): Promise<UdeployApplication[]> {
    return this.http.udeploy<UdeployApplication[]>('/cli/application');
  }

  listEnvironments(application: string): Promise<UdeployEnvironment[]> {
    return this.http.udeploy<UdeployEnvironment[]>('/cli/application/environmentsInApplication', {
      params: { application }
    });
  }

  listComponents(): Promise<UdeployComponent[]> {
    return this.http.udeploy<UdeployComponent[]>('/cli/component');
  }

  listVersions(component: string): Promise<UdeployVersion[]> {
    return this.http.udeploy<UdeployVersion[]>('/cli/component/versions', {
      params: { component }
    });
  }

  createVersion(component: string, name: string): Promise<UdeployVersionCreateResult> {
    return this.http.udeploy<UdeployVersionCreateResult>('/cli/version/createVersion', {
      method: 'POST',
      params: { component, name }
    });
  }

  finishImporting(component: string, version: string): Promise<void> {
    return this.http.udeploy<void>('/cli/version/finishedImporting', {
      method: 'POST',
      params: { component, version }
    });
  }

  runProcess(opts: UdeployRunProcessOptions): Promise<UdeployProcessRequest> {
    return this.http.udeploy<UdeployProcessRequest>('/cli/applicationProcessRequest/request', {
      method: 'PUT',
      body: {
        application: opts.application,
        applicationProcess: opts.applicationProcess,
        environment: opts.environment,
        onlyChanged: opts.onlyChanged ?? false,
        ...(opts.versions ? { versions: opts.versions } : {}),
        ...(opts.snapshot ? { snapshot: opts.snapshot } : {}),
        ...(opts.properties ? { properties: opts.properties } : {}),
      }
    });
  }

  getRequestStatus(requestId: string): Promise<UdeployRequestStatus> {
    return this.http.udeploy<UdeployRequestStatus>('/cli/applicationProcessRequest/requestStatus', {
      params: { requestId }
    });
  }

  getRequestInfo(requestId: string): Promise<UdeployRequestInfo> {
    return this.http.udeploy<UdeployRequestInfo>('/cli/applicationProcessRequest/requestInfo', {
      params: { requestId }
    });
  }
}
