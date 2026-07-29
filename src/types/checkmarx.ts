export interface CxOneTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface CxOneProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  groups: string[];
  tags: Record<string, string>;
  repoUrl?: string;
  mainBranch?: string;
}

export interface CxOneScan {
  id: string;
  status: string;
  projectId: string;
  projectName: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  initiator: string;
  tags: Record<string, string>;
  engines?: Record<string, { status: string }>;
}

export interface CxOneResultsSummary {
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  infoSeverity: number;
  severitiesTotalCount?: number;
}

export interface CxOneProjectsResponse {
  projects: CxOneProject[] | null;
  totalCount: number;
  filteredTotalCount: number;
}

export interface CxOneScansResponse {
  scans: CxOneScan[] | null;
  totalCount: number;
  filteredTotalCount: number;
}
