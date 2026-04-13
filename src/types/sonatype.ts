export interface SonatypeApplication {
  id: string;
  publicId: string;
  name: string;
  organizationId?: string;
  contactUserName?: string;
  applicationTags?: Array<{ id: string; tagId: string; applicationId: string }>;
}

export interface SonatypeApplicationsResponse {
  applications: SonatypeApplication[];
}

export interface SonatypeReport {
  stage: string;
  reportId: string;
  evaluationDate: string;
  reportDataUrl: string;
  reportHtmlUrl: string;
  embeddableReportHtmlUrl?: string;
  isForMonitoring: boolean;
  applicationId: string;
  applicationName: string;
}

export interface SonatypeComponentHash {
  hash?: string | null;
}

export interface SonatypeComponentCoordinates {
  packageId?: string;
  groupId?: string;
  artifactId?: string;
  version?: string;
  extension?: string;
  qualifier?: string;
  name?: string;
}

export interface SonatypeComponent {
  packageUrl?: string;
  hash?: string;
  sha256?: string;
  componentIdentifier?: {
    format: string;
    coordinates: SonatypeComponentCoordinates;
  };
  displayName?: string;
  pathnames?: string[];
  proprietary?: boolean;
}

export interface SonatypeConstraintFact {
  reference?: string;
  reason?: string;
}

export interface SonatypeConstraint {
  constraintId: string;
  constraintName: string;
  operatorName: string;
  conditions: Array<{
    conditionSummary: string;
    conditionReason: string;
    triggerJson?: string;
    triggerReference?: string;
  }>;
}

export interface SonatypePolicyViolation {
  policyId: string;
  policyName: string;
  policyViolationId: string;
  threatLevel: number;
  constraintViolations: Array<{
    constraintId: string;
    constraintName: string;
    reasons: Array<{
      reason: string;
      reference?: {
        value: string;
        type: string;
      };
    }>;
  }>;
  component: SonatypeComponent;
  waived?: boolean;
  grandfathered?: boolean;
}

export interface SonatypePolicyViolationsResponse {
  applicationId: string;
  reportId: string;
  reportTime: number;
  reportTitle: string;
  counts: {
    partiallyMatchedComponentCount: number;
    unmatchedComponentCount: number;
    totalComponentCount: number;
    exactlyMatchedComponentCount: number;
  };
  components: Array<{
    component: SonatypeComponent;
    violations: SonatypePolicyViolation[];
    licenseData?: unknown;
    securityData?: unknown;
  }>;
}

export interface SonatypeRemediationVersion {
  packageUrl: string;
  packageVersion?: string;
  status?: string;
}

export interface SonatypeRemediationComponentResult {
  packageUrl: string;
  recommendedVersions?: SonatypeRemediationVersion[];
  noVersionChange?: boolean;
  versionChanges?: Array<{
    data: {
      packageUrl: string;
      threatLevelReduction: number;
    };
    type: string;
  }>;
}

export interface SonatypeRemediationResponse {
  remediation: {
    versionChanges: Array<{
      type: string;
      data: {
        packageUrl: string;
        componentIdentifier?: {
          format: string;
          coordinates: SonatypeComponentCoordinates;
        };
        threatLevelReduction: number;
      };
    }>;
  };
}
