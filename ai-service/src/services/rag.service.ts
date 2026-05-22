import { chatCompletion, type ChatContextItem } from '../lib/llm/index.js';
import { searchSimilar } from '../lib/chroma.js';
import { buildTicketDocument } from '../lib/text.js';

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
  history?: { role: string; content: string }[];
}) {
  const retrieved = await searchSimilar({
    queryText: payload.ticketContext
      ? `${payload.ticketContext}\n\nUser question: ${payload.message}`
      : payload.message,
    topK: 5,
  });

  const contextBlock = retrieved
    .map(
      (r, i) =>
        `--- Source ${i + 1}: ${r.jiraKey} (${(r.similarityScore * 100).toFixed(0)}% match) ---\n${r.summary}\nResolution: ${r.resolutionSummary}`
    )
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

  const system = `You are a Jira Ticket Intelligence Assistant powered by GitLab Duo.
Answer questions using the provided context from historical Jira tickets.
If the context is insufficient, say so and suggest what to investigate.
Be concise, technical, and actionable. Reference ticket keys when relevant. Use markdown headings.`;

  const user = `${payload.ticketContext ? `Current Ticket Context:\n${payload.ticketContext}\n\n` : ''}Retrieved Historical Tickets:\n${contextBlock || 'No relevant tickets found.'}\n\nUser Question: ${payload.message}`;

  const history = (payload.history || [])
    .filter((h) => h.role === 'user' || h.role === 'assistant')
    .map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const answer = await chatCompletion(system, user, history, gitlabContext);

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
