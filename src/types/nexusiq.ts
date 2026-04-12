// Sonatype Nexus IQ (Lifecycle) REST API v2 response types

// --- Applications ---

export interface NexusIqApplication {
  id: string;
  publicId: string;
  name: string;
  organizationId: string;
  contactUserName?: string;
  applicationTags?: Array<{ id: string; tagId: string; applicationId: string }>;
}

export interface NexusIqApplicationsResponse {
  applications: NexusIqApplication[];
}

// --- Reports ---

export interface NexusIqReport {
  stage: string;
  applicationId: string;
  evaluationDate: string;
  reportTitle: string;
  reportDataUrl: string;
  reportHtmlUrl?: string;
  embeddableReportHtml?: string;
}

// --- Policy Violations ---

export interface NexusIqConstraintFact {
  reason: string;
  reference?: { value: string; url?: string };
}

export interface NexusIqConstraint {
  constraintId: string;
  constraintName: string;
  operator: string;
  conditions: Array<{
    conditionSummary: string;
    conditionReason: string;
    triggerJson?: string;
    triggerReference?: string;
  }>;
}

export interface NexusIqViolation {
  policyId: string;
  policyName: string;
  policyThreatCategory: string;
  policyThreatLevel: number;
  waived: boolean;
  constraints: NexusIqConstraint[];
  grandfathered?: boolean;
}

export interface NexusIqViolatingComponent {
  hash: string;
  componentIdentifier: {
    format: string;
    coordinates: Record<string, string>;
  };
  packageUrl?: string;
  displayName: string;
  pathnames?: string[];
  violations: NexusIqViolation[];
}

export interface NexusIqPolicyReport {
  applicationId: string;
  reportId?: string;
  counts: {
    partiallyMatchedComponentCount: number;
    exactlyMatchedComponentCount: number;
    totalComponentCount: number;
    grandfatheredPolicyViolationCount?: number;
  };
  components: NexusIqViolatingComponent[];
}

// --- Remediation ---

export interface NexusIqRemediationComponent {
  packageUrl?: string;
  hash?: string;
  componentIdentifier?: {
    format: string;
    coordinates: Record<string, string>;
  };
  displayName?: string;
}

export interface NexusIqVersionChange {
  type: 'next-no-violations' | 'next-non-failing' | string;
  data: {
    component: NexusIqRemediationComponent;
  };
}

export interface NexusIqRemediationResponse {
  remediation: {
    versionChanges: NexusIqVersionChange[];
  };
}
