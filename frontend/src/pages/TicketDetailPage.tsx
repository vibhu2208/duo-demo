import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Sparkles, MessageSquare, GitCompare } from 'lucide-react';
import { ticketsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/card';

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.get(id!),
    enabled: !!id,
  });

  const analyzeMutation = useMutation({
    mutationFn: () => ticketsApi.analyze(id!),
    onSuccess: () => refetch(),
  });

  const { data: similarData } = useQuery({
    queryKey: ['similar', id],
    queryFn: () => ticketsApi.similar(id!),
    enabled: !!id,
  });

  if (isLoading) return <div>Loading ticket...</div>;
  if (!data?.ticket) return <div>Ticket not found</div>;

  const { ticket, comments, recommendation } = data;
  const rec = recommendation as {
    probable_root_cause?: string;
    recommended_steps?: string[];
    likely_resolution?: string;
    investigation_checklist?: string[];
    possible_fixes?: string[];
    confidence_score?: number;
  } | null;

  const steps = Array.isArray(rec?.recommended_steps)
    ? rec.recommended_steps
    : typeof rec?.recommended_steps === 'string'
    ? JSON.parse(rec.recommended_steps)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-lg text-primary">{ticket.jira_key}</span>
            <Badge>{ticket.status}</Badge>
            {ticket.priority && <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">{ticket.priority}</Badge>}
          </div>
          <h2 className="text-2xl font-bold">{ticket.title}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {ticket.issue_type && `${ticket.issue_type} · `}
            {ticket.category && `${ticket.category} · `}
            {ticket.assignee && `Assignee: ${ticket.assignee}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            {analyzeMutation.isPending ? 'Analyzing...' : 'Run AI Analysis'}
          </Button>
          <Link to={`/chat?ticketId=${ticket.id}`}>
            <Button variant="outline">
              <MessageSquare className="h-4 w-4 mr-1" />
              Chat
            </Button>
          </Link>
          <Link to={`/similar?ticketId=${ticket.id}`}>
            <Button variant="outline">
              <GitCompare className="h-4 w-4 mr-1" />
              Similar
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-lg">Description</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{ticket.description || 'No description'}</p>
            {ticket.error_keywords?.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1">
                {ticket.error_keywords.map((k: string) => (
                  <Badge key={k} className="bg-red-100 text-red-800 dark:bg-red-900">{k}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">AI Recommendation</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {rec ? (
              <>
                {rec.confidence_score != null && (
                  <p className="text-muted-foreground">
                    Confidence: {(rec.confidence_score * 100).toFixed(0)}%
                  </p>
                )}
                <div>
                  <h4 className="font-semibold">Probable Root Cause</h4>
                  <p>{rec.probable_root_cause}</p>
                </div>
                <div>
                  <h4 className="font-semibold">Likely Resolution</h4>
                  <p>{rec.likely_resolution}</p>
                </div>
                {steps.length > 0 && (
                  <div>
                    <h4 className="font-semibold">Recommended Steps</h4>
                    <ol className="list-decimal list-inside space-y-1">
                      {steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ol>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Run AI Analysis to generate recommendations.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Similar Resolved Tickets</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(similarData?.similar || []).map((s: {
              ticket: { id: string; jira_key: string; title: string; status: string };
              similarity_score: number;
              resolution_summary: string;
            }) => (
              <div key={s.ticket.id} className="flex justify-between items-start p-3 border rounded-md">
                <div>
                  <Link to={`/tickets/${s.ticket.id}`} className="font-mono text-primary hover:underline">
                    {s.ticket.jira_key}
                  </Link>
                  <p className="text-sm">{s.ticket.title}</p>
                  {s.resolution_summary && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.resolution_summary}</p>
                  )}
                </div>
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 shrink-0">
                  {(s.similarity_score * 100).toFixed(0)}% match
                </Badge>
              </div>
            ))}
            {!similarData?.similar?.length && (
              <p className="text-muted-foreground text-sm">No similar tickets found. Sync more resolved tickets.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Comments ({comments?.length || 0})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(comments || []).map((c: { id: string; author: string; body: string; created_at_jira: string }) => (
            <div key={c.id} className="border-l-2 border-primary pl-4 py-2">
              <p className="text-xs text-muted-foreground">{c.author}</p>
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
