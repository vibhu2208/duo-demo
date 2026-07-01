import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;

export function getApiErrorMessage(err: unknown, fallback: string): string {
  const ax = err as {
    response?: { status?: number; data?: { error?: unknown; message?: string } };
    message?: string;
  };
  if (ax.response?.status === 404) {
    return 'Backend API not found (404). Ensure the backend is running and BACKEND_PORT in .env matches — then restart the frontend dev server.';
  }
  if (ax.response?.status === 403) {
    return 'Admin access required to save GitLab configuration.';
  }
  const data = ax.response?.data;
  if (typeof data?.error === 'string') return data.error;
  if (data?.error && typeof data.error === 'object') {
    const fieldErrors = (data.error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
    if (fieldErrors) {
      const first = Object.entries(fieldErrors)[0];
      if (first) return `${first[0]}: ${first[1].join(', ')}`;
    }
  }
  if (typeof data?.message === 'string') return data.message;
  return ax.message || fallback;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  register: (email: string, password: string, name: string) =>
    api.post('/auth/register', { email, password, name }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const ticketsApi = {
  list: (params?: { status?: string; search?: string; limit?: number; offset?: number }) =>
    api.get('/tickets', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/tickets/${id}`).then((r) => r.data),
  similar: (id: string, topK = 5) =>
    api.get(`/tickets/${id}/similar`, { params: { topK } }).then((r) => r.data),
  analyze: (id: string) => api.post(`/tickets/${id}/analyze`).then((r) => r.data),
  import: (jiraKey: string) => api.post('/tickets/import', { jiraKey }).then((r) => r.data),
};

export type JiraConnectionTestResult = {
  ok: boolean;
  authorization: 'success' | 'failed' | 'not_configured';
  httpStatus?: number;
  message: string;
  details: {
    baseUrl?: string;
    apiUrl?: string;
    deploymentType?: string;
    authMethod: string;
    jiraUsername?: string;
    displayName?: string;
    emailAddress?: string;
    serverVersion?: string;
    serverTitle?: string;
    projectKey?: string;
    projectName?: string;
    projectAccessible?: boolean;
    syncFilter?: string;
    syncFilterLabel?: string;
    matchingTicketCount?: number;
    insecureSsl?: boolean;
    testedAt: string;
  };
};

export const jiraApi = {
  config: () => api.get('/jira/config').then((r) => r.data),
  saveConfig: (data: {
    baseUrl: string;
    username: string;
    apiToken?: string;
    projectKey?: string;
    deploymentType?: 'cloud' | 'server';
    syncFilter?: 'resolved' | 'closed' | 'both';
    insecureSsl?: boolean;
  }) => api.put('/jira/config', data).then((r) => r.data),
  testConnection: (data?: {
    baseUrl?: string;
    username?: string;
    apiToken?: string;
    projectKey?: string;
    deploymentType?: 'cloud' | 'server';
    syncFilter?: 'resolved' | 'closed' | 'both';
    insecureSsl?: boolean;
  }) => api.post<JiraConnectionTestResult>('/jira/test-connection', data ?? {}).then((r) => r.data),
  sync: () => api.post('/jira/sync').then((r) => r.data),
  syncLogs: () => api.get('/jira/sync/logs').then((r) => r.data),
};

export const chatApi = {
  query: (data: { message: string; sessionId?: string; ticketId?: string }) =>
    api.post('/chat/query', data, { timeout: 120000 }).then((r) => r.data),
  sessions: () => api.get('/chat/sessions').then((r) => r.data),
  messages: (sessionId: string) =>
    api.get(`/chat/sessions/${sessionId}/messages`).then((r) => r.data),
  createSession: (ticketId?: string, title?: string) =>
    api.post('/chat/sessions', { ticketId, title }).then((r) => r.data),
};

export const analyticsApi = {
  summary: () => api.get('/analytics/summary').then((r) => r.data),
};

export const aiApi = {
  status: () => api.get('/ai/status').then((r) => r.data),
};

export type GitLabConnectionTestResult = {
  ok: boolean;
  authorization: 'success' | 'failed' | 'not_configured';
  httpStatus?: number;
  message: string;
  details: {
    baseUrl?: string;
    username?: string;
    name?: string;
    defaultGroup?: string;
    projectCount?: number;
    insecureSsl?: boolean;
    testedAt: string;
  };
};

export type GitLabProject = {
  fullName: string;
  projectPath: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  webUrl: string | null;
};

export type SecurityScanRun = {
  id: string;
  repoFullName: string;
  branch: string;
  commitSha: string | null;
  status: string;
  filesScanned: number;
  findingsCount: number;
  severitySummary: Record<string, number>;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type SecurityFinding = {
  id: string;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  codeSnippet: string | null;
  confidence: number | null;
};

export const gitlabApi = {
  config: () => api.get('/gitlab/config').then((r) => r.data),
  saveConfig: (data: {
    baseUrl: string;
    token?: string;
    defaultGroup?: string;
    insecureSsl?: boolean;
  }) => api.put('/gitlab/config', data).then((r) => r.data),
  testConnection: (data?: {
    baseUrl?: string;
    token?: string;
    defaultGroup?: string;
    insecureSsl?: boolean;
  }) => api.post<GitLabConnectionTestResult>('/gitlab/test-connection', data ?? {}).then((r) => r.data),
  projects: () => api.get<{ projects: GitLabProject[] }>('/gitlab/projects').then((r) => r.data),
  dashboard: () => api.get('/gitlab/dashboard').then((r) => r.data),
  scan: (data: { projectPath: string; branch?: string }) =>
    api.post<SecurityScanRun>('/gitlab/scan', data, { timeout: 180000 }).then((r) => r.data),
  scans: (params?: { limit?: number; offset?: number }) =>
    api.get<{ scans: SecurityScanRun[]; total: number }>('/gitlab/scans', { params }).then((r) => r.data),
  getScan: (id: string) =>
    api.get<SecurityScanRun & { findings: SecurityFinding[] }>(`/gitlab/scans/${id}`).then((r) => r.data),
  findings: (id: string, params?: { severity?: string; category?: string }) =>
    api.get<{ findings: SecurityFinding[] }>(`/gitlab/scans/${id}/findings`, { params }).then((r) => r.data),
};
