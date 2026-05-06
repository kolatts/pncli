export interface ServiceNowReference {
  link: string;
  value: string;
}

export interface ServiceNowChangeRequest {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  state: string;
  type: string;
  priority: string;
  risk: string;
  impact: string;
  category: string;
  assignment_group: ServiceNowReference | string;
  assigned_to: ServiceNowReference | string;
  requested_by: ServiceNowReference | string;
  opened_by: ServiceNowReference | string;
  start_date: string;
  end_date: string;
  sys_created_on: string;
  sys_updated_on: string;
  close_code: string;
  close_notes: string;
  approval: string;
}

export interface ServiceNowTableResponse<T> {
  result: T[];
}

export interface ServiceNowSingleResponse<T> {
  result: T;
}
