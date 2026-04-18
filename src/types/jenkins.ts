export interface JenkinsLastBuild {
  number: number;
  url: string;
  result: string | null;
}

export interface JenkinsJob {
  name: string;
  url: string;
  color: string;
  description: string | null;
  buildable: boolean;
  lastBuild: JenkinsLastBuild | null;
}

export interface JenkinsListJobsResponse {
  jobs: JenkinsJob[];
}

export interface JenkinsBuildArtifact {
  displayPath: string;
  fileName: string;
  relativePath: string;
}

export interface JenkinsBuildParameter {
  name: string;
  value: string | boolean | number | null;
}

export interface JenkinsBuildAction {
  _class?: string;
  parameters?: JenkinsBuildParameter[];
}

export interface JenkinsBuild {
  number: number;
  url: string;
  result: string | null;
  duration: number;
  estimatedDuration: number;
  timestamp: number;
  building: boolean;
  displayName: string;
  fullDisplayName: string;
  description: string | null;
  id: string;
  keepLog: boolean;
  queueId: number;
  actions: JenkinsBuildAction[];
}

export interface JenkinsJobDetail extends JenkinsJob {
  builds: Pick<JenkinsBuild, 'number' | 'url' | 'result' | 'duration' | 'timestamp' | 'building' | 'displayName'>[];
  nextBuildNumber: number;
  inQueue: boolean;
}

export interface JenkinsQueueItem {
  id: number;
  url: string;
  why: string | null;
  stuck: boolean;
  blocked: boolean;
  buildable: boolean;
  executable?: {
    number: number;
    url: string;
  };
}

export interface JenkinsLog {
  id: number;
  href: string;
  size: number;
  nodeId: string;
}
