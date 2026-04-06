// SonarQube Server (Data Center) API response types

export interface SonarSystemStatus {
  id: string;
  version: string;
  status: 'UP' | 'DOWN' | 'STARTING' | 'RESTARTING' | 'DB_MIGRATION_NEEDED' | 'DB_MIGRATION_RUNNING';
}

// --- Quality Gate ---

export interface SonarQualityGateCondition {
  status: 'OK' | 'WARN' | 'ERROR' | 'NONE';
  metricKey: string;
  comparator: string;
  periodIndex?: number;
  errorThreshold?: string;
  actualValue?: string;
}

export interface SonarQualityGateStatus {
  projectStatus: {
    status: 'OK' | 'WARN' | 'ERROR' | 'NONE';
    conditions: SonarQualityGateCondition[];
    periods?: Array<{ index: number; mode: string; date: string; parameter?: string }>;
    ignoredConditions: boolean;
  };
}

// --- Issues ---

export interface SonarTextRange {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface SonarIssue {
  key: string;
  rule: string;
  severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
  component: string;
  project: string;
  line?: number;
  textRange?: SonarTextRange;
  status: string;
  message: string;
  effort?: string;
  debt?: string;
  author?: string;
  tags: string[];
  type: 'BUG' | 'VULNERABILITY' | 'CODE_SMELL';
  creationDate: string;
  updateDate: string;
}

export interface SonarIssuesResponse {
  total: number;
  p: number;
  ps: number;
  issues: SonarIssue[];
  components?: Array<{ key: string; name: string; qualifier: string; path?: string }>;
}

// --- Measures ---

export interface SonarMeasure {
  metric: string;
  value?: string;
  bestValue?: boolean;
  period?: { value: string; bestValue: boolean };
}

export interface SonarMeasuresComponent {
  component: {
    key: string;
    name: string;
    qualifier: string;
    measures: SonarMeasure[];
  };
  metrics?: Array<{ key: string; name: string; description: string; domain: string; type: string }>;
}

// --- Projects ---

export interface SonarProject {
  key: string;
  name: string;
  qualifier: string;
  visibility: string;
  lastAnalysisDate?: string;
  revision?: string;
}

export interface SonarProjectsResponse {
  paging: { pageIndex: number; pageSize: number; total: number };
  components: SonarProject[];
}

// --- Hotspots ---

export interface SonarHotspot {
  key: string;
  component: string;
  project: string;
  securityCategory: string;
  vulnerabilityProbability: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'TO_REVIEW' | 'REVIEWED';
  resolution?: 'FIXED' | 'SAFE' | 'ACKNOWLEDGED';
  line?: number;
  message: string;
  author?: string;
  creationDate: string;
  updateDate: string;
}

export interface SonarHotspotsResponse {
  paging: { pageIndex: number; pageSize: number; total: number };
  hotspots: SonarHotspot[];
  components?: Array<{ key: string; qualifier: string; name: string; path?: string }>;
}
