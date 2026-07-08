import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, AlertCircle, PlugZap, XCircle, Shield } from 'lucide-react';
import { jiraApi, gitlabApi, githubApi, getApiErrorMessage, type JiraConnectionTestResult, type GitLabConnectionTestResult, type GitHubConnectionTestResult } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type JiraDeploymentType = 'server' | 'cloud';
type JiraSyncFilter = 'resolved' | 'closed' | 'both';

const SYNC_FILTER_OPTIONS: { value: JiraSyncFilter; label: string; description: string }[] = [
  {
    value: 'resolved',
    label: 'Resolved only',
    description: 'Tickets with a resolution set (Fixed, Done, etc.)',
  },
  {
    value: 'closed',
    label: 'Closed status only',
    description: 'Tickets where Jira status is Closed',
  },
  {
    value: 'both',
    label: 'Resolved or Closed',
    description: 'Either has a resolution or status is Closed',
  },
];

function ConnectionTestPanel({ result }: { result: JiraConnectionTestResult }) {
  const { details } = result;
  const isSuccess = result.authorization === 'success';

  return (
    <div
      className={`mt-4 rounded-md border p-4 text-sm space-y-2 ${
        isSuccess
          ? 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-900'
          : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900'
      }`}
    >
      <p className={`font-medium ${isSuccess ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
        {result.message}
      </p>
      <dl className="grid gap-1 text-muted-foreground">
        <div className="flex gap-2">
          <dt className="font-medium text-foreground min-w-[140px]">Authorization</dt>
          <dd>
            {result.authorization === 'success' && 'Completed successfully'}
            {result.authorization === 'failed' && 'Failed'}
            {result.authorization === 'not_configured' && 'Not configured'}
            {result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}
          </dd>
        </div>
        {details.baseUrl && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Base URL</dt>
            <dd className="break-all">{details.baseUrl}</dd>
          </div>
        )}
        {details.apiUrl && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">API endpoint</dt>
            <dd className="break-all">{details.apiUrl}/myself</dd>
          </div>
        )}
        {details.authMethod && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Auth method</dt>
            <dd>{details.authMethod}</dd>
          </div>
        )}
        {details.displayName && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Jira user</dt>
            <dd>
              {details.displayName}
              {details.jiraUsername ? ` (${details.jiraUsername})` : ''}
            </dd>
          </div>
        )}
        {details.emailAddress && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Email</dt>
            <dd>{details.emailAddress}</dd>
          </div>
        )}
        {details.serverTitle && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Server</dt>
            <dd>
              {details.serverTitle}
              {details.serverVersion ? ` · v${details.serverVersion}` : ''}
            </dd>
          </div>
        )}
        {details.projectKey && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Project</dt>
            <dd>
              {details.projectAccessible
                ? `${details.projectKey}${details.projectName ? ` — ${details.projectName}` : ''} (accessible)`
                : `${details.projectKey} (not found or no access)`}
            </dd>
          </div>
        )}
        {details.syncFilterLabel && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Sync filter</dt>
            <dd>{details.syncFilterLabel}</dd>
          </div>
        )}
        {details.matchingTicketCount !== undefined && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Tickets to sync</dt>
            <dd>{details.matchingTicketCount}</dd>
          </div>
        )}
        {details.insecureSsl && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">TLS</dt>
            <dd>Self-signed certificates allowed</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-medium text-foreground min-w-[140px]">Tested at</dt>
          <dd>{new Date(details.testedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

function GitLabConnectionTestPanel({ result }: { result: GitLabConnectionTestResult }) {
  const isSuccess = result.authorization === 'success';

  return (
    <div
      className={`mt-4 rounded-md border p-4 text-sm space-y-2 ${
        isSuccess
          ? 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-900'
          : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900'
      }`}
    >
      <p className={`font-medium ${isSuccess ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
        {result.message}
      </p>
      <dl className="grid gap-1 text-muted-foreground">
        {result.details.baseUrl && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">GitLab URL</dt>
            <dd className="break-all">{result.details.baseUrl}</dd>
          </div>
        )}
        {result.details.username && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">GitLab user</dt>
            <dd>{result.details.name || result.details.username}</dd>
          </div>
        )}
        {result.details.projectCount != null && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Accessible projects</dt>
            <dd>{result.details.projectCount}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-medium text-foreground min-w-[140px]">Tested at</dt>
          <dd>{new Date(result.details.testedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

function GitHubConnectionTestPanel({ result }: { result: GitHubConnectionTestResult }) {
  const isSuccess = result.authorization === 'success';

  return (
    <div
      className={`mt-4 rounded-md border p-4 text-sm space-y-2 ${
        isSuccess
          ? 'border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-900'
          : 'border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-900'
      }`}
    >
      <p className={`font-medium ${isSuccess ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
        {result.message}
      </p>
      <dl className="grid gap-1 text-muted-foreground">
        {result.details.login && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">GitHub user</dt>
            <dd>{result.details.name || result.details.login}</dd>
          </div>
        )}
        {result.details.repoCount != null && (
          <div className="flex gap-2">
            <dt className="font-medium text-foreground min-w-[140px]">Accessible repos</dt>
            <dd>{result.details.repoCount}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-medium text-foreground min-w-[140px]">Tested at</dt>
          <dd>{new Date(result.details.testedAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

export function AdminSyncPage() {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState('https://jira.your-company.internal');
  const [username, setUsername] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [deploymentType, setDeploymentType] = useState<JiraDeploymentType>('server');
  const [syncFilter, setSyncFilter] = useState<JiraSyncFilter>('closed');
  const [insecureSsl, setInsecureSsl] = useState(false);
  const [connectionTest, setConnectionTest] = useState<JiraConnectionTestResult | null>(null);
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState('https://gitlab.engine-onprem.capgemini.com');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabGroup, setGitlabGroup] = useState('');
  const [gitlabInsecureSsl, setGitlabInsecureSsl] = useState(false);
  const [gitlabTestResult, setGitlabTestResult] = useState<GitLabConnectionTestResult | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubTestResult, setGithubTestResult] = useState<GitHubConnectionTestResult | null>(null);

  const { data: config, refetch } = useQuery({
    queryKey: ['jira-config'],
    queryFn: jiraApi.config,
  });

  useEffect(() => {
    if (!config) return;
    if (config.baseUrl) setBaseUrl(config.baseUrl);
    if (config.username) setUsername(config.username);
    if (config.projectKey) setProjectKey(config.projectKey);
    if (config.deploymentType) setDeploymentType(config.deploymentType);
    if (config.syncFilter) setSyncFilter(config.syncFilter);
    if (config.insecureSsl) setInsecureSsl(config.insecureSsl);
  }, [config]);

  const { data: gitlabConfig, refetch: refetchGitlab } = useQuery({
    queryKey: ['gitlab-config'],
    queryFn: gitlabApi.config,
  });

  useEffect(() => {
    if (!gitlabConfig) return;
    if (gitlabConfig.baseUrl) setGitlabBaseUrl(gitlabConfig.baseUrl);
    if (gitlabConfig.defaultGroup) setGitlabGroup(gitlabConfig.defaultGroup);
    if (gitlabConfig.insecureSsl) setGitlabInsecureSsl(gitlabConfig.insecureSsl);
  }, [gitlabConfig]);

  const { data: githubConfig, refetch: refetchGithub } = useQuery({
    queryKey: ['github-config'],
    queryFn: githubApi.config,
  });

  useEffect(() => {
    if (!githubConfig) return;
    if (githubConfig.defaultOwner) setGithubOwner(githubConfig.defaultOwner);
  }, [githubConfig]);

  const { data: logs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: jiraApi.syncLogs,
  });

  const testPayload = () => ({
    baseUrl,
    username,
    apiToken: apiToken || undefined,
    projectKey,
    deploymentType,
    syncFilter,
    insecureSsl,
  });

  const testMutation = useMutation({
    mutationFn: () => jiraApi.testConnection(testPayload()),
    onSuccess: (data) => setConnectionTest(data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      jiraApi.saveConfig({
        baseUrl,
        username,
        apiToken,
        projectKey,
        deploymentType,
        syncFilter,
        insecureSsl,
      }),
    onSuccess: () => {
      refetch();
      testMutation.mutate();
    },
  });

  const syncMutation = useMutation({
    mutationFn: jiraApi.sync,
    onSuccess: () => refetch(),
  });

  const saveGitlabMutation = useMutation({
    mutationFn: () =>
      gitlabApi.saveConfig({
        baseUrl: gitlabBaseUrl,
        token: gitlabToken || undefined,
        defaultGroup: gitlabGroup || undefined,
        insecureSsl: gitlabInsecureSsl,
      }),
    onSuccess: () => {
      refetchGitlab();
      setGitlabToken('');
      testGitlabMutation.mutate();
    },
  });

  const testGitlabMutation = useMutation({
    mutationFn: () =>
      gitlabApi.testConnection({
        baseUrl: gitlabBaseUrl,
        token: gitlabToken || undefined,
        defaultGroup: gitlabGroup || undefined,
        insecureSsl: gitlabInsecureSsl,
      }),
    onSuccess: (data) => setGitlabTestResult(data),
  });

  const saveGithubMutation = useMutation({
    mutationFn: () =>
      githubApi.saveConfig({
        token: githubToken || undefined,
        defaultOwner: githubOwner || undefined,
      }),
    onSuccess: () => {
      refetchGithub();
      setGithubToken('');
      testGithubMutation.mutate();
    },
  });

  const testGithubMutation = useMutation({
    mutationFn: () =>
      githubApi.testConnection({
        token: githubToken || undefined,
        defaultOwner: githubOwner || undefined,
      }),
    onSuccess: (data) => setGithubTestResult(data),
  });

  const isAdmin = user?.role === 'admin';
  const isServer = deploymentType === 'server';
  const authOk = connectionTest?.authorization === 'success';
  const authFailed = connectionTest?.authorization === 'failed';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">Admin Sync Settings</h2>
        <p className="text-muted-foreground">Configure Jira connection and sync historical tickets</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {authOk ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : authFailed ? (
              <XCircle className="h-5 w-5 text-red-600" />
            ) : config?.configured ? (
              <AlertCircle className="h-5 w-5 text-orange-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-orange-500" />
            )}
            Connection Status
          </CardTitle>
          <CardDescription>
            {authOk
              ? 'Jira authorization verified — credentials are working.'
              : authFailed
                ? 'Jira authorization failed — use Test Connection for details.'
                : config?.configured
                  ? 'Credentials saved — click Test Connection to verify authorization.'
                  : 'Not configured — enter credentials below.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <dl className="grid gap-1">
            <div className="flex gap-2">
              <dt className="font-medium min-w-[120px]">Configured</dt>
              <dd>{config?.configured ? 'Yes' : 'No'}</dd>
            </div>
            {config?.source && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Source</dt>
                <dd>{config.source}</dd>
              </div>
            )}
            {config?.baseUrl && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Base URL</dt>
                <dd className="break-all">{config.baseUrl}</dd>
              </div>
            )}
            {config?.username && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Username</dt>
                <dd>{config.username}</dd>
              </div>
            )}
            {config?.syncFilterLabel && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Sync filter</dt>
                <dd>{config.syncFilterLabel}</dd>
              </div>
            )}
            {config?.projectKey && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Project</dt>
                <dd>{config.projectKey}</dd>
              </div>
            )}
            {config?.lastSyncAt && (
              <div className="flex gap-2">
                <dt className="font-medium min-w-[120px]">Last sync</dt>
                <dd>{new Date(config.lastSyncAt).toLocaleString()}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-medium min-w-[120px]">Sync status</dt>
              <dd>{config?.syncStatus || 'idle'}</dd>
            </div>
          </dl>

          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              <PlugZap className={`h-4 w-4 mr-2 ${testMutation.isPending ? 'animate-pulse' : ''}`} />
              {testMutation.isPending ? 'Testing...' : 'Test Connection'}
            </Button>
          )}

          {connectionTest && <ConnectionTestPanel result={connectionTest} />}
          {testMutation.isError && (
            <p className="text-sm text-red-600">
              {(testMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                'Connection test failed'}
            </p>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Jira Credentials</CardTitle>
              <CardDescription>
                {isServer
                  ? 'Internal Jira Server / Data Center — use your Jira username and password or personal access token.'
                  : 'Jira Cloud — use your Atlassian account email and API token from account settings.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Deployment</label>
                <select
                  value={deploymentType}
                  onChange={(e) => setDeploymentType(e.target.value as JiraDeploymentType)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="server">Internal (Jira Server / Data Center)</option>
                  <option value="cloud">Atlassian Cloud</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={isServer ? 'https://jira.host.internal:8443' : 'https://company.atlassian.net'}
                />
              </div>
              <div>
                <label className="text-sm font-medium">{isServer ? 'Username' : 'Email'}</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  type={isServer ? 'text' : 'email'}
                  placeholder={isServer ? 'jira.username' : 'you@company.com'}
                  autoComplete="username"
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  {isServer ? 'Password or Personal Access Token' : 'API Token'}
                </label>
                <Input
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  type="text"
                  className="font-mono"
                  placeholder={isServer ? 'your-password-or-PAT' : 'your-atlassian-api-token'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {isServer
                    ? 'Leave blank when testing or saving to keep the password already stored in the database.'
                    : 'Create an API token in your Atlassian account security settings.'}
                </p>
              </div>
              {isServer && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={insecureSsl}
                    onChange={(e) => setInsecureSsl(e.target.checked)}
                    className="rounded border-input"
                  />
                  Allow self-signed certificate (required for many internal Jira instances on port 8443)
                </label>
              )}
              <div>
                <label className="text-sm font-medium">Project Key (optional)</label>
                <Input value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="PROJ" />
              </div>
              <div>
                <label className="text-sm font-medium">Sync filter</label>
                <select
                  value={syncFilter}
                  onChange={(e) => setSyncFilter(e.target.value as JiraSyncFilter)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {SYNC_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {SYNC_FILTER_OPTIONS.find((o) => o.value === syncFilter)?.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  Save Configuration
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={testMutation.isPending}
                >
                  <PlugZap className="h-4 w-4 mr-2" />
                  Test Connection
                </Button>
              </div>
              {saveMutation.isError && (
                <p className="text-sm text-red-600">
                  {(saveMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                    'Failed to save configuration'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sync Historical Tickets</CardTitle>
              <CardDescription>
                Fetches only new tickets (already-synced tickets are skipped), stores in PostgreSQL, generates embeddings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending || !authOk}
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Syncing...' : 'Start Sync'}
              </Button>
              {!authOk && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Test connection successfully before syncing.
                </p>
              )}
              {syncMutation.isSuccess && (
                <div className="mt-4 p-4 bg-green-50 dark:bg-green-950 rounded-md text-sm">
                  <p>Fetched from Jira: {syncMutation.data.fetched}</p>
                  <p>New tickets added: {syncMutation.data.created}</p>
                  <p>Already in database (skipped): {syncMutation.data.skipped}</p>
                  <p>Embeddings indexed: {syncMutation.data.embeddingsIndexed}</p>
                </div>
              )}
              {syncMutation.isError && (
                <p className="mt-4 text-sm text-red-600">
                  {(syncMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                    'Sync failed'}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground">Admin access required to configure sync.</p>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>GitLab Connection (On-Prem)</CardTitle>
            </div>
            <CardDescription>
              Connect to GitLab on-prem with a Personal Access Token (scope:{' '}
              <code className="text-xs">api</code>) to scan one file at a time from your projects.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {gitlabConfig?.configured && (
              <div className="mb-4 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                GitLab configured
                {gitlabConfig.source === 'environment' && ' (from environment)'}
                {gitlabConfig.username && ` — ${gitlabConfig.username}`}
              </div>
            )}

            <div className="space-y-4 max-w-lg">
              <div>
                <label className="text-sm font-medium">GitLab URL</label>
                <Input
                  value={gitlabBaseUrl}
                  onChange={(e) => setGitlabBaseUrl(e.target.value)}
                  placeholder="https://gitlab.engine-onprem.capgemini.com"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Personal Access Token</label>
                <Input
                  type="password"
                  value={gitlabToken}
                  onChange={(e) => setGitlabToken(e.target.value)}
                  placeholder={gitlabConfig?.configured ? '••••••••' : 'glpat-...'}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank when saving to keep the token already stored in the database.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Default group (optional)</label>
                <Input
                  value={gitlabGroup}
                  onChange={(e) => setGitlabGroup(e.target.value)}
                  placeholder="capgemini/team-name"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Limits project list to a GitLab group; leave empty for all your projects.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={gitlabInsecureSsl}
                  onChange={(e) => setGitlabInsecureSsl(e.target.checked)}
                  className="rounded border-input"
                />
                Allow self-signed certificate (internal GitLab)
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => saveGitlabMutation.mutate()}
                  disabled={saveGitlabMutation.isPending}
                >
                  Save GitLab Config
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testGitlabMutation.mutate()}
                  disabled={testGitlabMutation.isPending}
                >
                  <PlugZap className="h-4 w-4 mr-2" />
                  Test Connection
                </Button>
              </div>
              {saveGitlabMutation.isError && (
                <p className="text-sm text-red-600">
                  {getApiErrorMessage(saveGitlabMutation.error, 'Failed to save GitLab configuration')}
                </p>
              )}
            </div>

            {gitlabTestResult && <GitLabConnectionTestPanel result={gitlabTestResult} />}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>GitHub Connection (Code Security)</CardTitle>
            </div>
            <CardDescription>
              Connect with a GitHub Personal Access Token (scope:{' '}
              <code className="text-xs">repo</code>) to scan one file at a time from your repositories.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {githubConfig?.configured && (
              <div className="mb-4 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                GitHub configured
                {githubConfig.source === 'environment' && ' (from environment)'}
                {githubConfig.login && ` — ${githubConfig.login}`}
              </div>
            )}

            <div className="space-y-4 max-w-lg">
              <div>
                <label className="text-sm font-medium">Personal Access Token</label>
                <Input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={githubConfig?.configured ? '••••••••' : 'ghp_...'}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank when saving to keep the token already stored in the database.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Default org/user (optional)</label>
                <Input
                  value={githubOwner}
                  onChange={(e) => setGithubOwner(e.target.value)}
                  placeholder="your-org-or-username"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Limits repo list to an organization; leave empty for all accessible repos.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => saveGithubMutation.mutate()}
                  disabled={saveGithubMutation.isPending}
                >
                  Save GitHub Config
                </Button>
                <Button
                  variant="outline"
                  onClick={() => testGithubMutation.mutate()}
                  disabled={testGithubMutation.isPending}
                >
                  <PlugZap className="h-4 w-4 mr-2" />
                  Test Connection
                </Button>
              </div>
              {saveGithubMutation.isError && (
                <p className="text-sm text-red-600">
                  {getApiErrorMessage(saveGithubMutation.error, 'Failed to save GitHub configuration')}
                </p>
              )}
            </div>

            {githubTestResult && <GitHubConnectionTestPanel result={githubTestResult} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">Sync History</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {(logs?.logs || []).map((l: {
              id: string;
              started_at: string;
              status: string;
              tickets_fetched: number;
              tickets_created: number;
              tickets_updated: number;
              embeddings_indexed: number;
              error_message?: string;
            }) => (
              <div key={l.id} className="p-2 border rounded-md space-y-1">
                <div className="flex justify-between">
                  <span>{new Date(l.started_at).toLocaleString()}</span>
                  <span>
                    {l.status} · {l.tickets_created} new · {l.tickets_updated} skipped · {l.embeddings_indexed} embedded
                  </span>
                </div>
                {l.error_message && (
                  <p className="text-red-600 text-xs break-words">{l.error_message}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
