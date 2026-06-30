import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { jiraApi } from '@/lib/api';
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

export function AdminSyncPage() {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState('https://jira.your-company.internal');
  const [username, setUsername] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [deploymentType, setDeploymentType] = useState<JiraDeploymentType>('server');
  const [syncFilter, setSyncFilter] = useState<JiraSyncFilter>('closed');

  const { data: config, refetch } = useQuery({
    queryKey: ['jira-config'],
    queryFn: jiraApi.config,
  });

  useEffect(() => {
    if (!config) return;
    if (config.baseUrl) setBaseUrl(config.baseUrl);
    if (config.projectKey) setProjectKey(config.projectKey);
    if (config.deploymentType) setDeploymentType(config.deploymentType);
    if (config.syncFilter) setSyncFilter(config.syncFilter);
  }, [config]);

  const { data: logs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: jiraApi.syncLogs,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      jiraApi.saveConfig({ baseUrl, username, apiToken, projectKey, deploymentType, syncFilter }),
    onSuccess: () => refetch(),
  });

  const syncMutation = useMutation({
    mutationFn: jiraApi.sync,
    onSuccess: () => refetch(),
  });

  const isAdmin = user?.role === 'admin';
  const isServer = deploymentType === 'server';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">Admin Sync Settings</h2>
        <p className="text-muted-foreground">Configure Jira connection and sync historical tickets</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {config?.configured ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-orange-500" />
            )}
            Connection Status
          </CardTitle>
          <CardDescription>
            {config?.configured
              ? `Connected via ${config.source} · ${config.deploymentType === 'server' ? 'Internal Jira' : 'Jira Cloud'} · Project: ${config.projectKey || 'all'}`
              : 'Not configured — set credentials below or in .env'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {config?.baseUrl && <p>Base URL: {config.baseUrl}</p>}
          {config?.syncFilterLabel && <p>Sync filter: {config.syncFilterLabel}</p>}
          {config?.lastSyncAt && (
            <p>Last sync: {new Date(config.lastSyncAt).toLocaleString()}</p>
          )}
          <p>Status: {config?.syncStatus || 'idle'}</p>
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
                  placeholder={isServer ? 'https://jira.your-company.internal' : 'https://company.atlassian.net'}
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
                    ? 'Enter your Jira password or a personal access token. Shown as plain text so you can verify token format.'
                    : 'Create an API token in your Atlassian account security settings.'}
                </p>
              </div>
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
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Save Configuration
              </Button>
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
                Fetches tickets matching your sync filter, stores in PostgreSQL, generates embeddings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Syncing...' : 'Start Sync'}
              </Button>
              {syncMutation.isSuccess && (
                <div className="mt-4 p-4 bg-green-50 dark:bg-green-950 rounded-md text-sm">
                  <p>Fetched: {syncMutation.data.fetched}</p>
                  <p>Created: {syncMutation.data.created} · Updated: {syncMutation.data.updated}</p>
                  <p>Embeddings indexed: {syncMutation.data.embeddingsIndexed}</p>
                </div>
              )}
              {syncMutation.isError && (
                <p className="mt-4 text-sm text-red-600">
                  {(syncMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Sync failed'}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-muted-foreground">Admin access required to configure sync.</p>
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
              embeddings_indexed: number;
              error_message?: string;
            }) => (
              <div key={l.id} className="flex justify-between p-2 border rounded-md">
                <span>{new Date(l.started_at).toLocaleString()}</span>
                <span>
                  {l.status} · {l.tickets_fetched} fetched · {l.embeddings_indexed} embedded
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
