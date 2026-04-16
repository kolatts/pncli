export type SnowDisplayValue = string | { value: string; display_value: string };

export interface SnowChangeRequest {
  sys_id: string;
  number: string;
  short_description: string;
  description: SnowDisplayValue;
  state: SnowDisplayValue;
  priority: SnowDisplayValue;
  risk: SnowDisplayValue;
  impact: SnowDisplayValue;
  type: SnowDisplayValue;
  assigned_to: SnowDisplayValue;
  opened_by: SnowDisplayValue;
  cmdb_ci: SnowDisplayValue;
  start_date: string;
  end_date: string;
  sys_created_on: string;
  sys_updated_on: string;
}

export interface SnowWorkNote {
  sys_id: string;
  value: string;
  element: string;
  sys_created_on: string;
  sys_created_by: string;
}

export interface SnowListResult<T> {
  result: T[];
}

export interface SnowSingleResult<T> {
  result: T;
}
