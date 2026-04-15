export interface JenkinsJob {
  name: string;
  url: string;
  color?: string;
  description?: string | null;
  buildable?: boolean;
  fullName?: string;
  lastBuild?: JenkinsBuildRef | null;
  lastCompletedBuild?: JenkinsBuildRef | null;
  lastSuccessfulBuild?: JenkinsBuildRef | null;
  lastFailedBuild?: JenkinsBuildRef | null;
  jobs?: JenkinsJob[]; // for folder/multibranch jobs
}

export interface JenkinsBuildRef {
  number: number;
  url: string;
}

export interface JenkinsBuild {
  number: number;
  url: string;
  displayName?: string;
  fullDisplayName?: string;
  result?: string | null;
  building: boolean;
  duration: number;
  estimatedDuration?: number;
  timestamp: number;
  description?: string | null;
  causes?: Array<{ shortDescription?: string }>;
  actions?: unknown[];
}

export interface JenkinsJobDetail extends JenkinsJob {
  builds?: JenkinsBuildRef[];
  healthReport?: Array<{ description: string; score: number }>;
  property?: unknown[];
}

export interface JenkinsCrumb {
  crumb: string;
  crumbRequestField: string;
}

export interface JenkinsTriggerResponse {
  queueId?: number;
  location?: string;
}
