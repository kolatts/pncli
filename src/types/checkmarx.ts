export interface CheckmarxTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface CheckmarxProject {
  id: number;
  teamId: string;
  name: string;
  isPublic: boolean;
  description: string;
  createdDate: string;
  projectOwner: string;
}

export interface CheckmarxScanStatus {
  id: number;
  name: string;
  details: string | null;
}

export interface CheckmarxScanStage {
  value: string;
  stateValue: number;
  details: string | null;
}

export interface CheckmarxScan {
  id: number;
  status: CheckmarxScanStatus;
  scanState: CheckmarxScanStage;
  owner: string;
  origin: string;
  initiatorName: string;
  project: { id: number; value: string };
  team: { id: string; value: string };
  engineServer: { id: number; value: string };
  engineId: number;
  isPublic: boolean;
  isIncremental: boolean;
  processCanceled: boolean;
  comment: string;
  dateAndTime: {
    startedOn: string;
    finishedOn: string;
    engineStartedOn: string;
    engineFinishedOn: string;
  };
}

export interface CheckmarxResultsStats {
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  infoSeverity: number;
  statisticsCalculationDate: string;
}
