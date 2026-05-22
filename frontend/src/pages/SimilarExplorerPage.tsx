import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ticketsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui/card';

export function SimilarExplorerPage() {
  const [searchParams] = useSearchParams();
  const [ticketId, setTicketId] = useState(searchParams.get('ticketId') || '');
  const [queryId, setQueryId] = useState(searchParams.get('ticketId') || '');

  const { data: tickets } = useQuery({
    queryKey: ['tickets-list'],
    queryFn: () => ticketsApi.list({ limit: 100 }),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['similar-explorer', queryId],
    queryFn: () => ticketsApi.similar(queryId, 10),
    enabled: !!queryId,
  });

  const selectedTicket = tickets?.tickets?.find((t: { id: string }) => t.id === queryId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Similar Ticket Explorer</h2>
        <p className="text-muted-foreground">
          Vector similarity search across historical resolved tickets
        </p>
      </div>

      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium">Select ticket</label>
          <select
            className="w-full h-10 mt-1 rounded-md border border-input bg-background px-3 text-sm"
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
          >
            <option value="">Choose a ticket...</option>
            {(tickets?.tickets || []).map((t: { id: string; jira_key: string; title: string }) => (
              <option key={t.id} value={t.id}>
                {t.jira_key} — {t.title.slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => { setQueryId(ticketId); refetch(); }} disabled={!ticketId}>
          Find Similar
        </Button>
      </div>

      {selectedTicket && queryId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Source: {selectedTicket.jira_key}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{selectedTicket.title}</p>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-muted-foreground">Searching vector database...</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(data?.similar || []).map((s: {
          ticket: {
            id: string;
            jira_key: string;
            title: string;
            status: string;
            final_fix: string;
            resolution_time_hours: number;
            resolved_at_jira: string;
          };
          similarity_score: number;
          resolution_summary: string;
        }) => (
          <Card key={s.ticket.id}>
            <CardHeader className="flex flex-row justify-between items-start">
              <div>
                <Link to={`/tickets/${s.ticket.id}`} className="font-mono text-primary hover:underline">
                  {s.ticket.jira_key}
                </Link>
                <CardTitle className="text-base mt-1">{s.ticket.title}</CardTitle>
              </div>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900">
                {(s.similarity_score * 100).toFixed(1)}%
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Status:</span> {s.ticket.status}</p>
              {s.ticket.resolution_time_hours && (
                <p><span className="text-muted-foreground">Resolution time:</span> {s.ticket.resolution_time_hours.toFixed(1)}h</p>
              )}
              {s.resolution_summary && (
                <div className="mt-2 p-3 bg-muted rounded-md">
                  <p className="font-semibold text-xs mb-1">Resolution</p>
                  <p className="line-clamp-4">{s.resolution_summary}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {queryId && !isLoading && !data?.similar?.length && (
        <p className="text-muted-foreground">No similar tickets found. Sync more resolved tickets from Jira.</p>
      )}
    </div>
  );
}
