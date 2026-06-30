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
