import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart3, Clock, Repeat, Sparkles, Ticket } from 'lucide-react';
import { analyticsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@/components/ui/card';

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: analyticsApi.summary,
  });

  if (isLoading) return <div className="text-muted-foreground">Loading dashboard...</div>;

  const stats = [
    { label: 'Total Tickets', value: data?.tickets?.total ?? 0, icon: Ticket },
    { label: 'Open', value: data?.tickets?.open ?? 0, icon: BarChart3 },
    { label: 'Resolved', value: data?.tickets?.resolved ?? 0, icon: Repeat },
    { label: 'Avg Resolution (hrs)', value: data?.averageResolutionHours ?? 0, icon: Clock },
    { label: 'AI Usage (7d)', value: data?.aiUsage?.last7Days ?? 0, icon: Sparkles },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">Overview of tickets, patterns, and AI assistance</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>{s.label}</CardDescription>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.recentTickets || []).map((t: { id: string; jira_key: string; title: string; status: string }) => (
                <Link
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  className="flex items-center justify-between p-3 rounded-md border hover:bg-accent transition-colors"
                >
                  <div>
                    <span className="font-mono text-sm text-primary">{t.jira_key}</span>
                    <p className="text-sm truncate max-w-md">{t.title}</p>
                  </div>
                  <Badge className="bg-secondary">{t.status}</Badge>
                </Link>
              ))}
              {!data?.recentTickets?.length && (
                <p className="text-sm text-muted-foreground">No tickets yet. Sync from Jira in Admin Settings.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recurring Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.recurringIssues || []).map((r: { category: string; count: number }) => (
                <div key={r.category} className="flex justify-between items-center p-2 border rounded-md">
                  <span>{r.category}</span>
                  <Badge>{r.count} tickets</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Root Causes (AI)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.topRootCauses || []).map((c: { cause: string; count: number }, i: number) => (
                <div key={i} className="p-2 border rounded-md text-sm">
                  <p>{c.cause}</p>
                  <span className="text-muted-foreground text-xs">{c.count} analyses</span>
                </div>
              ))}
              {!data?.topRootCauses?.length && (
                <p className="text-sm text-muted-foreground">Run AI analysis on tickets to populate.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
