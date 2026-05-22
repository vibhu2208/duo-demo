import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { ticketsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, Badge } from '@/components/ui/card';

export function TicketSearchPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [importKey, setImportKey] = useState('');
  const [importing, setImporting] = useState(false);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['tickets', search, status],
    queryFn: () => ticketsApi.list({ search: search || undefined, status: status || undefined }),
  });

  const handleImport = async () => {
    if (!importKey.trim()) return;
    setImporting(true);
    try {
      const result = await ticketsApi.import(importKey.trim().toUpperCase());
      refetch();
      window.location.href = `/tickets/${result.ticketId}`;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Import failed';
      alert(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div>
          <h2 className="text-2xl font-bold">Ticket Search</h2>
          <p className="text-muted-foreground">Search synced tickets or import from Jira</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="PROJ-123"
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            className="w-36"
          />
          <Button onClick={handleImport} disabled={importing}>
            <Plus className="h-4 w-4 mr-1" />
            Import
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="Search by key, title, description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Done">Done</option>
          <option value="Resolved">Resolved</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-muted-foreground">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-4">Key</th>
                  <th className="p-4">Title</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Assignee</th>
                </tr>
              </thead>
              <tbody>
                {(data?.tickets || []).map((t: {
                  id: string;
                  jira_key: string;
                  title: string;
                  status: string;
                  priority: string;
                  assignee: string;
                }) => (
                  <tr key={t.id} className="border-b hover:bg-accent/50">
                    <td className="p-4">
                      <Link to={`/tickets/${t.id}`} className="font-mono text-primary hover:underline">
                        {t.jira_key}
                      </Link>
                    </td>
                    <td className="p-4 max-w-md truncate">{t.title}</td>
                    <td className="p-4"><Badge className="bg-secondary">{t.status}</Badge></td>
                    <td className="p-4">{t.priority || '-'}</td>
                    <td className="p-4">{t.assignee || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data?.total === 0 && !isLoading && (
            <p className="p-6 text-muted-foreground text-center">No tickets found</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
