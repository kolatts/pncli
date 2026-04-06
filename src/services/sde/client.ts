import type { HttpClient } from '../../lib/http.js';
import type {
  SdeServerInfo,
  SdeUser,
  SdeProject,
  SdeTask,
  SdeThreat,
  SdePaginatedResponse
} from '../../types/sde.js';

const API = '/api/v2';

export interface ListProjectsOpts {
  name?: string;
  slug?: string;
  search?: string;
  active?: string;
  ordering?: string;
  expand?: string;
  include?: string;
  page?: number;
  pageSize?: number;
}

export interface ListTasksOpts {
  projectId: number;
  phase?: string;
  priority?: string;
  status?: string;
  assignedTo?: string;
  source?: string;
  verification?: string;
  tag?: string;
  accepted?: string;
  relevant?: string;
  expand?: string;
  include?: string;
  page?: number;
  pageSize?: number;
}

export interface ListThreatsOpts {
  projectId: number;
  severity?: string;
  title?: string;
  threatId?: string;
  capecId?: string;
  componentId?: string;
  search?: string;
  ordering?: string;
  page?: number;
  pageSize?: number;
}

export interface ListUsersOpts {
  email?: string;
  firstName?: string;
  lastName?: string;
  isActive?: string;
  page?: number;
  pageSize?: number;
}

export class SdeClient {
  constructor(private http: HttpClient) {}

  async getServerInfo(): Promise<SdeServerInfo> {
    return this.http.sde<SdeServerInfo>(`${API}/server-info/`);
  }

  async getMe(): Promise<SdeUser> {
    return this.http.sde<SdeUser>(`${API}/users/me/`);
  }

  async getProject(projectId: number, expand?: string, include?: string): Promise<SdeProject> {
    return this.http.sde<SdeProject>(`${API}/projects/${projectId}/`, {
      params: { expand, include }
    });
  }

  async getTask(projectId: number, taskId: string, expand?: string, include?: string): Promise<SdeTask> {
    return this.http.sde<SdeTask>(`${API}/projects/${projectId}/tasks/${taskId}/`, {
      params: { expand, include }
    });
  }

  async listProjects(opts: ListProjectsOpts = {}): Promise<SdePaginatedResponse<SdeProject>> {
    return this.http.sde<SdePaginatedResponse<SdeProject>>(`${API}/projects/`, {
      params: {
        name: opts.name,
        slug: opts.slug,
        search: opts.search,
        active: opts.active,
        ordering: opts.ordering,
        expand: opts.expand,
        include: opts.include,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 100
      }
    });
  }

  async listAllProjects(opts: Omit<ListProjectsOpts, 'page' | 'pageSize'> = {}): Promise<SdeProject[]> {
    return this.http.sdePaginate<SdeProject>(async (page, pageSize) => {
      const resp = await this.http.sde<SdePaginatedResponse<SdeProject>>(`${API}/projects/`, {
        params: {
          name: opts.name,
          slug: opts.slug,
          search: opts.search,
          active: opts.active,
          ordering: opts.ordering,
          expand: opts.expand,
          include: opts.include,
          page,
          page_size: pageSize
        }
      });
      return { count: resp.count, results: resp.results };
    });
  }

  async listTasks(opts: ListTasksOpts): Promise<SdePaginatedResponse<SdeTask>> {
    return this.http.sde<SdePaginatedResponse<SdeTask>>(`${API}/projects/${opts.projectId}/tasks/`, {
      params: {
        phase: opts.phase,
        priority: opts.priority,
        status: opts.status,
        assigned_to: opts.assignedTo,
        source: opts.source,
        verification: opts.verification,
        tag: opts.tag,
        accepted: opts.accepted,
        relevant: opts.relevant,
        expand: opts.expand,
        include: opts.include,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 100
      }
    });
  }

  async listAllTasks(opts: Omit<ListTasksOpts, 'page' | 'pageSize'>): Promise<SdeTask[]> {
    return this.http.sdePaginate<SdeTask>(async (page, pageSize) => {
      const resp = await this.http.sde<SdePaginatedResponse<SdeTask>>(`${API}/projects/${opts.projectId}/tasks/`, {
        params: {
          phase: opts.phase,
          priority: opts.priority,
          status: opts.status,
          assigned_to: opts.assignedTo,
          source: opts.source,
          verification: opts.verification,
          tag: opts.tag,
          accepted: opts.accepted,
          relevant: opts.relevant,
          expand: opts.expand,
          include: opts.include,
          page,
          page_size: pageSize
        }
      });
      return { count: resp.count, results: resp.results };
    });
  }

  async listThreats(opts: ListThreatsOpts): Promise<SdePaginatedResponse<SdeThreat>> {
    return this.http.sde<SdePaginatedResponse<SdeThreat>>(`${API}/projects/${opts.projectId}/threats/`, {
      params: {
        severity: opts.severity,
        title: opts.title,
        threat_id: opts.threatId,
        capec_id: opts.capecId,
        component_id: opts.componentId,
        search: opts.search,
        ordering: opts.ordering,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 100
      }
    });
  }

  async listAllThreats(opts: Omit<ListThreatsOpts, 'page' | 'pageSize'>): Promise<SdeThreat[]> {
    return this.http.sdePaginate<SdeThreat>(async (page, pageSize) => {
      const resp = await this.http.sde<SdePaginatedResponse<SdeThreat>>(`${API}/projects/${opts.projectId}/threats/`, {
        params: {
          severity: opts.severity,
          title: opts.title,
          threat_id: opts.threatId,
          capec_id: opts.capecId,
          component_id: opts.componentId,
          search: opts.search,
          ordering: opts.ordering,
          page,
          page_size: pageSize
        }
      });
      return { count: resp.count, results: resp.results };
    });
  }

  async listUsers(opts: ListUsersOpts = {}): Promise<SdePaginatedResponse<SdeUser>> {
    return this.http.sde<SdePaginatedResponse<SdeUser>>(`${API}/users/`, {
      params: {
        email: opts.email,
        first_name: opts.firstName,
        last_name: opts.lastName,
        is_active: opts.isActive,
        page: opts.page ?? 1,
        page_size: opts.pageSize ?? 100
      }
    });
  }

  async listAllUsers(opts: Omit<ListUsersOpts, 'page' | 'pageSize'> = {}): Promise<SdeUser[]> {
    return this.http.sdePaginate<SdeUser>(async (page, pageSize) => {
      const resp = await this.http.sde<SdePaginatedResponse<SdeUser>>(`${API}/users/`, {
        params: {
          email: opts.email,
          first_name: opts.firstName,
          last_name: opts.lastName,
          is_active: opts.isActive,
          page,
          page_size: pageSize
        }
      });
      return { count: resp.count, results: resp.results };
    });
  }
}
