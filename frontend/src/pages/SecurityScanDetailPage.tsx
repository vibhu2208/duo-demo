import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { gitlabApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 border-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200 border-yellow-300',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-300',
  info: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 border-gray-300',
};

const SEVERITIES = ['all', 'critical', 'high', 'medium', 'low', 'info'] as const;

function FindingRow({ finding }: { finding: {
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
} }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn('capitalize', SEVERITY_COLORS[finding.severity] || SEVERITY_COLORS.info)}>
              {finding.severity}
            </Badge>
            <Badge className="bg-secondary capitalize">{finding.category}</Badge>
            {finding.confidence != null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(finding.confidence * 100)}% confidence
              </span>
            )}
          </div>
          <p className="font-medium text-sm">{finding.title}</p>
          <p className="text-xs font-mono text-muted-foreground truncate">
            {finding.filePath}
            {finding.lineStart != null && `:${finding.lineStart}`}
            {finding.lineEnd != null && finding.lineEnd !== finding.lineStart && `–${finding.lineEnd}`}
          </p>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pl-10 space-y-3 border-t bg-muted/20">
          {finding.description && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{finding.description}</p>
            </div>
          )}
          {finding.recommendation && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Recommendation</p>
              <p className="text-sm">{finding.recommendation}</p>
            </div>
          )}
          {finding.codeSnippet && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Code</p>
              <pre className="text-xs bg-background border rounded p-2 overflow-x-auto font-mono">
                {finding.codeSnippet}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SecurityScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const { data: scan, isLoading, error } = useQuery({
    queryKey: ['gitlab-scan', id],
    queryFn: () => gitlabApi.getScan(id!),
    enabled: !!id,
  });

  if (isLoading) return <p className="text-muted-foreground">Loading scan...</p>;
  if (error || !scan) {
    return (
      <div className="space-y-4">
        <Link to="/security" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Code Security
        </Link>
        <p className="text-red-600">Scan not found or failed to load.</p>
      </div>
    );
  }

  const filteredFindings =
    severityFilter === 'all'
      ? scan.findings
      : scan.findings.filter((f) => f.severity === severityFilter);

  const duration =
    scan.completedAt && scan.startedAt
      ? Math.round((new Date(scan.completedAt).getTime() - new Date(scan.startedAt).getTime()) / 1000)
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/security" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to Code Security
        </Link>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          {scan.repoFullName}
        </h2>
        <p className="text-muted-foreground font-mono text-sm">
          {scan.branch}
          {scan.commitSha && ` @ ${scan.commitSha.slice(0, 7)}`}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Status</CardDescription></CardHeader>
          <CardContent>
            <Badge className="capitalize">{scan.status}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Files Scanned</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{scan.filesScanned}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Findings</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-bold">{scan.findingsCount}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Duration</CardDescription></CardHeader>
          <CardContent>
            <div className="text-sm font-medium">{duration != null ? `${duration}s` : '—'}</div>
          </CardContent>
        </Card>
      </div>

      {scan.errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200">
          {scan.errorMessage}
        </div>
      )}

      {scan.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">AI Assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{scan.summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Findings</CardTitle>
              <CardDescription>{filteredFindings.length} issue(s) shown</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1">
              {SEVERITIES.map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize',
                    severityFilter === sev
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground hover:bg-accent'
                  )}
                >
                  {sev}
                  {sev !== 'all' && scan.severitySummary?.[sev] != null && (
                    <span className="ml-1 opacity-70">({scan.severitySummary[sev]})</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {scan.findingsCount === 0
                ? 'No security issues identified in the scanned files.'
                : 'No findings match the selected severity filter.'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredFindings.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
