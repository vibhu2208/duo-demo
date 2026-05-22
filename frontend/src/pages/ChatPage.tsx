import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Send,
  Bot,
  User,
  Sparkles,
  Ticket,
  Loader2,
  AlertCircle,
  Zap,
  BookOpen,
} from 'lucide-react';
import { chatApi, aiApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { MarkdownText } from '@/components/chat/MarkdownText';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  { icon: BookOpen, text: 'Have we seen this before?' },
  { icon: Zap, text: 'What fixed this issue last time?' },
  { icon: Sparkles, text: 'Summarize similar incidents' },
  { icon: Bot, text: 'Suggest debugging steps' },
  { icon: AlertCircle, text: 'What is the probable root cause?' },
  { icon: Ticket, text: 'Generate investigation checklist' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: { jiraKey: string; title: string; similarityScore: number }[];
}

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const ticketId = searchParams.get('ticketId') || undefined;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string>();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: aiStatus } = useQuery({
    queryKey: ['ai-status'],
    queryFn: aiApi.status,
    refetchInterval: 30000,
  });

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      chatApi.query({ message, sessionId, ticketId }),
    onSuccess: (data, message) => {
      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: data.answer, sources: data.sources },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatMutation.isPending]);

  const send = (text: string) => {
    if (!text.trim() || chatMutation.isPending) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    chatMutation.mutate(text.trim());
  };

  const errorMsg =
    chatMutation.isError &&
    ((chatMutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
      'Failed to reach AI service. Is ai-service running on port 3002?');

  const duoReady = aiStatus?.aiReady && !aiStatus?.hardcodedMock;
  const isMock = aiStatus?.hardcodedMock;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -m-2 md:-m-0">
      {/* AI provider status */}
      {aiStatus && (
        <div
          className={cn(
            'shrink-0 mb-3 rounded-lg border px-4 py-3 text-sm flex items-start gap-3',
            duoReady && 'bg-green-500/10 border-green-500/30 text-green-800 dark:text-green-300',
            isMock && 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200',
            !duoReady && !isMock && 'bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-300'
          )}
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {duoReady
                ? `Live AI: ${aiStatus.providerLabel}`
                : isMock
                ? 'Demo mode — hardcoded template responses (not GitLab Duo)'
                : `GitLab Duo not ready — ${aiStatus.setupMessage || 'configure .env'}`}
            </p>
            {!duoReady && !isMock && (
              <p className="text-xs mt-1 opacity-90">
                Add <code className="bg-black/10 px-1 rounded">GITLAB_TOKEN</code> to .env and restart ai-service.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 rounded-xl border bg-gradient-to-r from-primary/10 via-background to-violet-500/10 p-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <h2 className="text-xl font-bold">Duo Intelligence Chat</h2>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium border',
                  duoReady
                    ? 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30'
                    : 'bg-primary/15 text-primary border-primary/20'
                )}
              >
                {aiStatus?.providerLabel || 'RAG'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xl">
              Grounded answers from your resolved Jira history. Retrieved tickets are cited below each response.
              {ticketId && (
                <span className="text-primary font-medium"> · Linked to active ticket</span>
              )}
            </p>
          </div>
        </div>

        {/* Quick prompts */}
        <div className="flex flex-wrap gap-2 mt-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              onClick={() => send(s.text)}
              disabled={chatMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border bg-background/80 hover:bg-primary/10 hover:border-primary/30 transition-all disabled:opacity-50"
            >
              <s.icon className="h-3.5 w-3.5 text-primary" />
              {s.text}
            </button>
          ))}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 rounded-xl border bg-card/50 backdrop-blur-sm overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.length === 0 && !chatMutation.isPending && (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px] text-center px-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Ask anything about past incidents</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-6">
                Similar tickets are retrieved via vector search, then answers come from your configured AI provider (GitLab Duo).
                Run <code className="text-xs bg-muted px-1.5 py-0.5 rounded">npm run seed:demo</code> for test tickets.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s.text}
                    onClick={() => send(s.text)}
                    className="text-left text-sm p-3 rounded-lg border hover:border-primary/40 hover:bg-accent transition-colors"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
            >
              <div
                className={cn(
                  'h-8 w-8 rounded-full shrink-0 flex items-center justify-center',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted border'
                )}
              >
                {m.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4 text-primary" />
                )}
              </div>

              <div
                className={cn(
                  'max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm',
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted/80 border rounded-tl-sm'
                )}
              >
                {m.role === 'user' ? (
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <MarkdownText content={m.content} />
                )}

                {m.sources && m.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border/60">
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Sources
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {m.sources.map((s, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-background border"
                        >
                          <Ticket className="h-3 w-3 text-primary" />
                          <span className="font-mono font-medium">{s.jiraKey}</span>
                          <span className="text-muted-foreground">
                            {(s.similarityScore * 100).toFixed(0)}%
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted/80 border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Searching tickets & generating answer...</span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t bg-background/95 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 items-end max-w-4xl mx-auto"
          >
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask about root cause, similar tickets, debugging steps..."
                disabled={chatMutation.isPending}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[48px] max-h-[120px]"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={chatMutation.isPending || !input.trim()}
              className="rounded-xl h-12 w-12 shrink-0"
            >
              {chatMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground mt-2">
            Enter to send · Shift+Enter for new line ·{' '}
            {duoReady ? 'GitLab Duo + RAG' : isMock ? 'Mock templates' : 'Configure GitLab Duo in .env'}
          </p>
        </div>
      </div>
    </div>
  );
}
