import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { jiraApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AdminSyncPage() {
  const { user } = useAuth();
  const [baseUrl, setBaseUrl] = useState('https://your-domain.atlassian.net');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [projectKey, setProjectKey] = useState('');

  const { data: config, refetch } = useQuery({
    queryKey: ['jira-config'],
    queryFn: jiraApi.config,
  });

  const { data: logs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: jiraApi.syncLogs,
  });

  const saveMutation = useMutation({
    mutationFn: () => jiraApi.saveConfig({ baseUrl, email, apiToken, projectKey }),
    onSuccess: () => refetch(),
  });

  const syncMutation = useMutation({
    mutationFn: jiraApi.sync,
    onSuccess: () => refetch(),
  });

  const isAdmin = user?.role === 'admin';

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
              ? `Connected via ${config.source} · Project: ${config.projectKey || 'all'}`
              : 'Not configured — set credentials below or in .env'}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
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
                Use a Jira Cloud API token from{' '}
                <a href="https://id.atlassian.com/manage-profile/security/api-tokens" className="text-primary underline" target="_blank" rel="noreferrer">
                  Atlassian account settings
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Base URL</label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://company.atlassian.net" />
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </div>
              <div>
                <label className="text-sm font-medium">API Token</label>
                <Input value={apiToken} onChange={(e) => setApiToken(e.target.value)} type="password" />
              </div>
              <div>
                <label className="text-sm font-medium">Project Key (optional)</label>
                <Input value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="PROJ" />
              </div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Save Configuration
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sync Historical Tickets</CardTitle>
              <CardDescription>
                Fetches resolved tickets, stores in PostgreSQL, generates embeddings in ChromaDB
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
