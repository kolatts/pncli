export interface SnowReference {
  link: string;
  value: string;
}

export interface SnowField {
  display_value: string;
  value: string;
}

export interface SnowChangeRequest {
  sys_id: string;
  number: string;
  short_description: string | SnowField;
  description: string | SnowField;
  state: string | SnowField;
  priority: string | SnowField;
  risk: string | SnowField;
  type: string | SnowField;
  category: string | SnowField;
  assigned_to: string | SnowReference | SnowField;
  assignment_group: string | SnowReference | SnowField;
  requested_by: string | SnowReference | SnowField;
  start_date: string | SnowField;
  end_date: string | SnowField;
  sys_created_on: string;
  sys_updated_on: string;
  [key: string]: unknown;
}

export interface SnowListResponse<T> {
  result: T[];
}

export interface SnowSingleResponse<T> {
  result: T;
}

export interface CreateChangeOpts {
  shortDescription: string;
  description?: string;
  type?: string;
  category?: string;
  priority?: string;
  risk?: string;
  assignedTo?: string;
  assignmentGroup?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateChangeOpts {
  shortDescription?: string;
  description?: string;
  state?: string;
  priority?: string;
  risk?: string;
  assignedTo?: string;
  assignmentGroup?: string;
  startDate?: string;
  endDate?: string;
}
