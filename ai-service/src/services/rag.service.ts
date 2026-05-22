import { chatCompletion, type ChatContextItem } from '../lib/llm/index.js';
import { searchSimilar } from '../lib/chroma.js';
import { buildTicketDocument } from '../lib/text.js';
import {
  MIN_SIMILARITY,
  formatChatAnswer,
  greetingReply,
  isGreeting,
  isSubstantiveQuestion,
} from '../lib/chat-utils.js';

function parseJsonFromLlm(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw.replace(/```json?\n?|\n?```/g, '').trim());
  } catch {
    return null;
  }
}

export async function analyzeTicket(payload: {
  title: string;
  description: string;
  comments?: string[];
}) {
  const system = `You are a Jira ticket analyst. Extract structured metadata from the ticket.
Respond ONLY with valid JSON, no markdown:
{
  "issueType": "bug|task|story|incident|other",
  "affectedModule": "module or component name",
  "errorKeywords": ["keyword1", "keyword2"],
  "severity": "critical|high|medium|low",
  "category": "short category label"
}`;

  const user = `Title: ${payload.title}\nDescription: ${payload.description}\nComments: ${(payload.comments || []).join('\n')}`;

  const raw = await chatCompletion(system, user);
  const json = parseJsonFromLlm(raw);

  if (!json) {
    throw new Error('AI returned invalid JSON for ticket analysis. Check GitLab Duo API access.');
  }

  return {
    issueType: String(json.issueType || 'other'),
    affectedModule: String(json.affectedModule || 'unknown'),
    errorKeywords: Array.isArray(json.errorKeywords) ? json.errorKeywords.map(String) : [],
    severity: String(json.severity || 'medium'),
    category: String(json.category || 'general'),
    embedding: [] as number[],
  };
}

export async function generateRecommendation(payload: {
  ticketId: string;
  title: string;
  description: string;
  similarTickets: {
    jiraKey: string;
    similarityScore: number;
    summary: string;
    resolutionSummary: string;
  }[];
}) {
  const context = payload.similarTickets
    .map(
      (t, i) =>
        `[${i + 1}] ${t.jiraKey} (similarity: ${(t.similarityScore * 100).toFixed(1)}%)\nSummary: ${t.summary}\nResolution: ${t.resolutionSummary}`
    )
    .join('\n\n');

  const system = `You are a senior engineer helping resolve Jira tickets using historical data.
Based on the current ticket and similar resolved tickets, provide actionable recommendations.
Respond ONLY with valid JSON:
{
  "probableRootCause": "string",
  "recommendedSteps": ["step1", "step2"],
  "likelyResolution": "string",
  "investigationChecklist": ["item1", "item2"],
  "possibleFixes": ["fix1", "fix2"],
  "confidenceScore": 0.0 to 1.0
}`;

  const user = `Current Ticket:\nTitle: ${payload.title}\nDescription: ${payload.description}\n\nSimilar Resolved Tickets:\n${context || 'No similar tickets found.'}`;

  const gitlabContext: ChatContextItem[] = payload.similarTickets.map((t) => ({
    category: 'issue' as const,
    id: t.jiraKey,
    content: `${t.summary}\nResolution: ${t.resolutionSummary}`,
    metadata: { title: t.jiraKey, resolution: t.resolutionSummary },
  }));

  const raw = await chatCompletion(system, user, [], gitlabContext);
  const json = parseJsonFromLlm(raw);

  if (!json) {
    throw new Error('AI returned invalid JSON for recommendations. Check GitLab Duo API access.');
  }

  return {
    probableRootCause: String(json.probableRootCause || ''),
    recommendedSteps: Array.isArray(json.recommendedSteps) ? json.recommendedSteps.map(String) : [],
    likelyResolution: String(json.likelyResolution || ''),
    investigationChecklist: Array.isArray(json.investigationChecklist)
      ? json.investigationChecklist.map(String)
      : [],
    possibleFixes: Array.isArray(json.possibleFixes) ? json.possibleFixes.map(String) : [],
    confidenceScore: Math.min(1, Math.max(0, Number(json.confidenceScore) || 0.5)),
  };
}

export async function ragChat(payload: {
  message: string;
  ticketContext?: string;
  dbContext?: string;
  dbStats?: { totalTickets: number; ticketsInPrompt: number };
  history?: { role: string; content: string }[];
}) {
  const message = payload.message.trim();

  if (isGreeting(message)) {
    return { answer: greetingReply(payload.dbStats), sources: [] };
  }

  const searchQuery = payload.ticketContext
    ? `${payload.ticketContext}\n\n${message}`
    : message;

  const allRetrieved = await searchSimilar({ queryText: searchQuery, topK: 8 });
  const retrieved = allRetrieved.filter((r) => r.similarityScore >= MIN_SIMILARITY);

  if (!isSubstantiveQuestion(message) && retrieved.length === 0) {
    return {
      answer:
        'I need a bit more detail to search historical tickets. Try asking about a specific error, ticket key, or symptom — e.g. *"Have we seen API timeouts before?"*',
      sources: [],
    };
  }

  const hasDbContext = !!(payload.dbContext && payload.dbContext.length > 100);
  const dbStats = payload.dbStats;

  const vectorBlock =
    retrieved.length > 0
      ? retrieved
          .map(
            (r) =>
              `--- ${r.jiraKey} (${(r.similarityScore * 100).toFixed(0)}% similar) ---\n${r.summary}\nResolution: ${r.resolutionSummary || 'N/A'}`
          )
          .join('\n\n')
      : '';

  const contextBlock = [
    dbStats
      ? `Database: ${dbStats.totalTickets} tickets stored; ${dbStats.ticketsInPrompt} included below.`
      : '',
    vectorBlock ? `## Vector search matches\n${vectorBlock}` : '',
    hasDbContext
      ? `## Tickets from database (PostgreSQL)\n${payload.dbContext}`
      : !vectorBlock
        ? 'No vector matches — use the database ticket section above if present.'
        : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const gitlabContext: ChatContextItem[] = retrieved.map((r) => ({
    category: 'issue' as const,
    id: r.jiraKey,
    content: `${r.summary}\nResolution: ${r.resolutionSummary}`,
    metadata: {
      title: r.jiraKey,
      resolution: r.resolutionSummary,
      similarity: String(r.similarityScore),
    },
  }));

  const system = `You are a Jira Ticket Intelligence assistant (GitLab Duo).

You DO have access to the user's Jira ticket database. Ticket data is provided below from PostgreSQL (full records) and vector search (semantic matches).

RULES:
- Reply in plain English markdown. NEVER output raw JSON.
- Use the database ticket section — it is real synced Jira data, not hypothetical.
- If database tickets are listed below, cite them by key (e.g. DEMO-106).
- Only say "I don't have context" if BOTH database and vector sections are empty.
- Keep answers practical: root cause, debugging steps, past fixes.`;

  const user = [
    payload.ticketContext ? `## Current ticket (user is viewing)\n${payload.ticketContext}\n` : '',
    `## Historical ticket knowledge base\n${contextBlock || 'No tickets loaded — ask user to run seed or Jira sync.'}`,
    `## User question\n${message}`,
  ].join('\n');

  const history = (payload.history || [])
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const rawAnswer = await chatCompletion(system, user, history, gitlabContext);
  const answer = formatChatAnswer(rawAnswer);

  return {
    answer,
    sources: retrieved.map((r) => ({
      jiraKey: r.jiraKey,
      title: r.summary.split('\n')[0]?.replace('Title: ', '') || r.jiraKey,
      similarityScore: r.similarityScore,
    })),
  };
}

export async function embedTicket(payload: {
  ticketId: string;
  jiraKey: string;
  title: string;
  description: string;
  comments: string[];
  resolution: string;
  labels: string[];
}) {
  const document = buildTicketDocument(payload);
  const { upsertTicketEmbedding } = await import('../lib/chroma.js');
  return upsertTicketEmbedding({
    ticketId: payload.ticketId,
    jiraKey: payload.jiraKey,
    document,
    metadata: {
      title: payload.title.slice(0, 200),
      hasResolution: payload.resolution ? 1 : 0,
      resolution: payload.resolution.slice(0, 500),
    },
  });
}
