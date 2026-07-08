import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, AlertTriangle, Scan, Loader2, X } from 'lucide-react';
import {
  gitlabApi,
  githubApi,
  getApiErrorMessage,
  type GitLabProject,
  type GitHubRepo,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type CodeProvider = 'gitlab' | 'github';

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
  provider,
  onClose,
  onSuccess,
}: {
  open: boolean;
  provider: CodeProvider;
  onClose: () => void;
  onSuccess: (scanId: string) => void;
}) {
  const isGitLab = provider === 'gitlab';

  const [selectedProject, setSelectedProject] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [selectedFile, setSelectedFile] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [useManual, setUseManual] = useState(false);

  const projectPath = isGitLab
    ? useManual
      ? manualPath.trim()
      : selectedProject
    : '';
  const repoFullName = !isGitLab
    ? useManual
      ? manualPath.trim()
      : selectedRepo
    : '';
  const repoOrProject = isGitLab ? projectPath : repoFullName;

  const [owner, repo] = !isGitLab && repoFullName.includes('/')
    ? repoFullName.split('/', 2)
    : ['', ''];

  const { data: projectsData, isLoading: projectsLoading, isError: projectsError, error: projectsFetchError } = useQuery({
    queryKey: ['gitlab-projects'],
    queryFn: gitlabApi.projects,
    enabled: open && isGitLab,
    retry: 1,
  });

  const { data: reposData, isLoading: reposLoading, isError: reposError, error: reposFetchError } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.repos,
    enabled: open && !isGitLab,
    retry: 1,
  });

  const {
    data: gitlabFilesData,
    isLoading: gitlabFilesLoading,
    isError: gitlabFilesError,
    error: gitlabFilesFetchError,
  } = useQuery({
    queryKey: ['gitlab-files', projectPath, branch],
    queryFn: () => gitlabApi.files(projectPath, branch),
    enabled: open && isGitLab && !!projectPath,
    retry: 1,
  });

  const {
    data: githubFilesData,
    isLoading: githubFilesLoading,
    isError: githubFilesError,
    error: githubFilesFetchError,
  } = useQuery({
    queryKey: ['github-files', owner, repo, branch],
    queryFn: () => githubApi.files(owner, repo, branch),
    enabled: open && !isGitLab && !!owner && !!repo,
    retry: 1,
  });

  const gitlabScanMutation = useMutation({
    mutationFn: gitlabApi.scan,
    onSuccess: (scan) => {
      onSuccess(scan.id);
      onClose();
    },
  });

  const githubScanMutation = useMutation({
    mutationFn: githubApi.scan,
    onSuccess: (scan) => {
      onSuccess(scan.id);
      onClose();
    },
  });

  const scanMutation = isGitLab ? gitlabScanMutation : githubScanMutation;

  const projects: GitLabProject[] = projectsData?.projects || [];
  const repos: GitHubRepo[] = reposData?.repos || [];
  const files: string[] = isGitLab
    ? gitlabFilesData?.files || []
    : githubFilesData?.files || [];
  const filesLoading = isGitLab ? gitlabFilesLoading : githubFilesLoading;
  const filesError = isGitLab ? gitlabFilesError : githubFilesError;
  const filesFetchError = isGitLab ? gitlabFilesFetchError : githubFilesFetchError;
  const reposOrProjectsLoading = isGitLab ? projectsLoading : reposLoading;
  const reposOrProjectsError = isGitLab ? projectsError : reposError;
  const reposOrProjectsFetchError = isGitLab ? projectsFetchError : reposFetchError;

  const handleProjectChange = (path: string) => {
    setSelectedProject(path);
    setUseManual(false);
    setSelectedFile('');
    const project = projects.find((p) => p.projectPath === path);
    if (project) setBranch(project.defaultBranch);
  };

  const handleRepoChange = (fullName: string) => {
    setSelectedRepo(fullName);
    setUseManual(false);
    setSelectedFile('');
    const r = repos.find((p) => p.fullName === fullName);
    if (r) setBranch(r.defaultBranch);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoOrProject || !selectedFile) return;
    if (isGitLab) {
      gitlabScanMutation.mutate({ projectPath: repoOrProject, branch, filePath: selectedFile });
    } else {
      githubScanMutation.mutate({ repoFullName: repoOrProject, branch, filePath: selectedFile });
    }
  };

  const canSubmit = !!repoOrProject && !!selectedFile;
  const hasRepoOrProject = isGitLab ? !!projectPath : !!owner && !!repo;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">New Security Scan</CardTitle>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <CardDescription>
            Scan one file from your {isGitLab ? 'GitLab project' : 'GitHub repo'}. The file is reviewed in small
            sections (~400 chars each) via AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {isGitLab ? 'GitLab project' : 'GitHub repository'}
              </label>
              {reposOrProjectsLoading ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Loading {isGitLab ? 'projects' : 'repositories'}...
                </p>
              ) : (
                <>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={useManual ? '' : isGitLab ? selectedProject : selectedRepo}
                    onChange={(e) =>
                      isGitLab ? handleProjectChange(e.target.value) : handleRepoChange(e.target.value)
                    }
                    disabled={useManual}
                  >
                    <option value="">Select {isGitLab ? 'a project' : 'a repository'}</option>
                    {isGitLab
                      ? projects.map((p) => (
                          <option key={p.projectPath} value={p.projectPath}>
                            {p.fullName} {p.private ? '(private)' : ''}
                          </option>
                        ))
                      : repos.map((r) => (
                          <option key={r.fullName} value={r.fullName}>
                            {r.fullName} {r.private ? '(private)' : ''}
                          </option>
                        ))}
                  </select>
                  {reposOrProjectsError && (
                    <p className="text-sm text-red-600 mt-2">
                      {getApiErrorMessage(
                        reposOrProjectsFetchError,
                        `Could not load ${isGitLab ? 'projects' : 'repositories'}`
                      )}
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
                  onChange={(e) => {
                    setUseManual(e.target.checked);
                    setSelectedFile('');
                  }}
                />
                Enter {isGitLab ? 'project path' : 'repository'} manually
              </label>
              {useManual && (
                <Input
                  className="mt-2"
                  value={manualPath}
                  onChange={(e) => {
                    setManualPath(e.target.value);
                    setSelectedFile('');
                  }}
                  placeholder={isGitLab ? 'group/subgroup/project' : 'owner/repo'}
                />
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Branch</label>
              <Input
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setSelectedFile('');
                }}
                placeholder="main"
              />
            </div>
            <div>
              <label className="text-sm font-medium">File to scan (one file only)</label>
              {!hasRepoOrProject ? (
                <p className="text-sm text-muted-foreground mt-1">
                  Select {isGitLab ? 'a project' : 'a repository'} first.
                </p>
              ) : filesLoading ? (
                <p className="text-sm text-muted-foreground mt-1">Loading files...</p>
              ) : (
                <>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono text-xs"
                    value={selectedFile}
                    onChange={(e) => setSelectedFile(e.target.value)}
                  >
                    <option value="">Select a file</option>
                    {files.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  {filesError && (
                    <p className="text-sm text-red-600 mt-2">
                      {getApiErrorMessage(filesFetchError, 'Could not load files')}
                    </p>
                  )}
                  {!filesLoading && files.length === 0 && !filesError && (
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
                      No scannable source files found on this branch.
                    </p>
                  )}
                </>
              )}
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
  const [provider, setProvider] = useState<CodeProvider>('gitlab');

  const { data: gitlabConfig } = useQuery({ queryKey: ['gitlab-config'], queryFn: gitlabApi.config });
  const { data: githubConfig } = useQuery({ queryKey: ['github-config'], queryFn: githubApi.config });

  const activeApi = provider === 'gitlab' ? gitlabApi : githubApi;
  const activeConfigured = provider === 'gitlab' ? gitlabConfig?.configured : githubConfig?.configured;

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: [provider === 'gitlab' ? 'gitlab-dashboard' : 'github-dashboard'],
    queryFn: activeApi.dashboard,
  });
  const { data: scansData, isLoading: scansLoading } = useQuery({
    queryKey: [provider === 'gitlab' ? 'gitlab-scans' : 'github-scans'],
    queryFn: () => activeApi.scans({ limit: 20 }),
  });

  const isAdmin = user?.role === 'admin';

  const handleScanSuccess = (scanId: string) => {
    queryClient.invalidateQueries({ queryKey: ['gitlab-scans'] });
    queryClient.invalidateQueries({ queryKey: ['github-scans'] });
    queryClient.invalidateQueries({ queryKey: ['gitlab-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['github-dashboard'] });
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
            {provider === 'gitlab' ? 'GitLab' : 'GitHub'} codebase scanner — one file at a time, reviewed in small
            sections for vulnerability detection
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setProvider('gitlab')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-sm transition-colors',
                provider === 'gitlab' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              GitLab
            </button>
            <button
              type="button"
              onClick={() => setProvider('github')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-sm transition-colors',
                provider === 'github' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              GitHub
            </button>
          </div>
          {isAdmin && (
            <Button onClick={() => setScanModalOpen(true)} disabled={!activeConfigured}>
              <Scan className="h-4 w-4 mr-2" />
              New Scan
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
        <strong>Advisory only:</strong> Findings are AI-generated from section-by-section review (~400 chars per section).
        Verify before acting. This is not a substitute for certified SAST tools.
      </div>

      {!activeConfigured && (
        <div className="rounded-md border p-4 text-sm">
          {provider === 'gitlab' ? 'GitLab' : 'GitHub'} is not configured.{' '}
          {isAdmin ? (
            <Link to="/admin" className="text-primary underline">
              Add your {provider === 'gitlab' ? 'GitLab' : 'GitHub'} credentials in Sync Settings
            </Link>
          ) : (
            `Ask an admin to configure ${provider === 'gitlab' ? 'GitLab' : 'GitHub'} access.`
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
          <CardDescription>
            History of single-file {provider === 'gitlab' ? 'GitLab' : 'GitHub'} security reviews
          </CardDescription>
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
                      {scan.branch} · {new Date(scan.startedAt).toLocaleString()} · {scan.filesScanned} file
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
                    {(scan.severitySummary?.critical ?? 0) > 0 && <SeverityBadge severity="critical" />}
                    {(scan.severitySummary?.high ?? 0) > 0 && <SeverityBadge severity="high" />}
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
        provider={provider}
        onClose={() => setScanModalOpen(false)}
        onSuccess={handleScanSuccess}
      />
    </div>
  );
}
