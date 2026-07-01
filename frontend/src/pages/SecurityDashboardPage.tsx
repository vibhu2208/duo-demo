import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, AlertTriangle, Scan, Loader2, X } from 'lucide-react';
import { gitlabApi, getApiErrorMessage, type GitLabProject } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 border-yellow-300',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-300',
  info: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 border-gray-300',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge className={cn('capitalize', SEVERITY_COLORS[severity] || SEVERITY_COLORS.info)}>
      {severity}
    </Badge>
  );
}

function NewScanModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (scanId: string) => void;
}) {
  const [selectedProject, setSelectedProject] = useState('');
  const [branch, setBranch] = useState('main');
  const [manualProject, setManualProject] = useState('');
  const [useManual, setUseManual] = useState(false);

  const { data: projectsData, isLoading: projectsLoading, isError: projectsError, error: projectsFetchError } = useQuery({
    queryKey: ['gitlab-projects'],
    queryFn: gitlabApi.projects,
    enabled: open,
    retry: 1,
  });

  const scanMutation = useMutation({
    mutationFn: gitlabApi.scan,
    onSuccess: (scan) => {
      onSuccess(scan.id);
      onClose();
    },
  });

  const projects: GitLabProject[] = projectsData?.projects || [];
  const selected = projects.find((p) => p.projectPath === selectedProject);

  const handleProjectChange = (projectPath: string) => {
    setSelectedProject(projectPath);
    setUseManual(false);
    const project = projects.find((p) => p.projectPath === projectPath);
    if (project) setBranch(project.defaultBranch);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const projectPath = useManual ? manualProject.trim() : selectedProject;
    if (!projectPath) return;
    scanMutation.mutate({ projectPath, branch });
  };

  const canSubmit = useManual ? !!manualProject.trim() : !!selectedProject;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">New Security Scan</CardTitle>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <CardDescription>Select a GitLab project to scan with GitLab Duo AI review</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">GitLab project</label>
              {projectsLoading ? (
                <p className="text-sm text-muted-foreground mt-1">Loading projects...</p>
              ) : (
                <>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={useManual ? '' : selectedProject}
                    onChange={(e) => handleProjectChange(e.target.value)}
                    disabled={useManual}
                  >
                    <option value="">Select a project</option>
                    {projects.map((p) => (
                      <option key={p.projectPath} value={p.projectPath}>
                        {p.fullName} {p.private ? '(private)' : ''}
                      </option>
                    ))}
                  </select>
                  {projectsError && (
                    <p className="text-sm text-red-600 mt-2">
                      {getApiErrorMessage(projectsFetchError, 'Could not load projects')}
                    </p>
                  )}
                  {!projectsLoading && projects.length === 0 && !projectsError && (
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                      No projects returned. Enter one manually below (e.g.{' '}
                      <code>capgemini/team/my-project</code>).
                    </p>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useManual}
                  onChange={(e) => setUseManual(e.target.checked)}
                />
                Enter project path manually
              </label>
              {useManual && (
                <Input
                  className="mt-2"
                  value={manualProject}
                  onChange={(e) => setManualProject(e.target.value)}
                  placeholder="group/subgroup/project-name"
                />
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Branch</label>
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
            {scanMutation.isError && (
              <p className="text-sm text-red-600">
                {(scanMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                  'Scan failed'}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit || scanMutation.isPending}>
                {scanMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Scan className="h-4 w-4 mr-2" />
                    Start Scan
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function SecurityDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [scanModalOpen, setScanModalOpen] = useState(false);

  const { data: config } = useQuery({ queryKey: ['gitlab-config'], queryFn: gitlabApi.config });
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['gitlab-dashboard'],
    queryFn: gitlabApi.dashboard,
  });
  const { data: scansData, isLoading: scansLoading } = useQuery({
    queryKey: ['gitlab-scans'],
    queryFn: () => gitlabApi.scans({ limit: 20 }),
  });

  const isAdmin = user?.role === 'admin';

  const handleScanSuccess = (scanId: string) => {
    queryClient.invalidateQueries({ queryKey: ['gitlab-scans'] });
    queryClient.invalidateQueries({ queryKey: ['gitlab-dashboard'] });
    navigate(`/security/scans/${scanId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Code Security
          </h2>
          <p className="text-muted-foreground">
            AI-assisted vulnerability review of GitLab on-prem projects (Capgemini)
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setScanModalOpen(true)} disabled={!config?.configured}>
            <Scan className="h-4 w-4 mr-2" />
            New Scan
          </Button>
        )}
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
        <strong>Advisory only:</strong> Findings are generated by GitLab Duo AI and should be verified before acting.
        This is not a substitute for certified SAST tools.
      </div>

      {!config?.configured && (
        <div className="rounded-md border p-4 text-sm">
          GitLab is not configured.{' '}
          {isAdmin ? (
            <Link to="/admin" className="text-primary underline">
              Add your GitLab URL and PAT in Sync Settings
            </Link>
          ) : (
            'Ask an admin to configure GitLab access.'
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Scans</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{statsLoading ? '—' : stats?.totalScans ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Critical Findings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{statsLoading ? '—' : stats?.criticalCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>High Findings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{statsLoading ? '—' : stats?.highCount ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last Scan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-medium">
              {statsLoading
                ? '—'
                : stats?.lastScanAt
                  ? new Date(stats.lastScanAt).toLocaleString()
                  : 'Never'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Scans</CardTitle>
          <CardDescription>History of AI security reviews on GitLab projects</CardDescription>
        </CardHeader>
        <CardContent>
          {scansLoading ? (
            <p className="text-muted-foreground">Loading scans...</p>
          ) : !scansData?.scans?.length ? (
            <p className="text-sm text-muted-foreground">No scans yet. Run your first scan to get started.</p>
          ) : (
            <div className="space-y-2">
              {scansData.scans.map((scan) => (
                <Link
                  key={scan.id}
                  to={`/security/scans/${scan.id}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-md border hover:bg-accent transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium">{scan.repoFullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {scan.branch} · {new Date(scan.startedAt).toLocaleString()} · {scan.filesScanned} files
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      className={cn(
                        scan.status === 'completed' && 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
                        scan.status === 'failed' && 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
                        scan.status === 'running' && 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                      )}
                    >
                      {scan.status}
                    </Badge>
                    {scan.findingsCount > 0 && (
                      <span className="text-xs text-muted-foreground">{scan.findingsCount} findings</span>
                    )}
                    {(scan.severitySummary?.critical ?? 0) > 0 && (
                      <SeverityBadge severity="critical" />
                    )}
                    {(scan.severitySummary?.high ?? 0) > 0 && (
                      <SeverityBadge severity="high" />
                    )}
                    {((scan.severitySummary?.critical ?? 0) > 0 || (scan.severitySummary?.high ?? 0) > 0) && (
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewScanModal
        open={scanModalOpen}
        onClose={() => setScanModalOpen(false)}
        onSuccess={handleScanSuccess}
      />
    </div>
  );
}
