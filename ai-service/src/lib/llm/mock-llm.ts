import type { ChatContextItem, ChatMessage } from './index.js';

/**
 * Demo LLM — no API key required. Uses retrieved Jira context to build grounded answers.
 */
export async function mockChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  _history: ChatMessage[] = [],
  additionalContext: ChatContextItem[] = []
): Promise<string> {
  const question = userPrompt.split('User Question:').pop()?.trim() || userPrompt;
  const q = question.toLowerCase();

  const issues = additionalContext.filter((c) => c.category === 'issue');
  const topIssue = issues[0];

  if (/seen this before|similar|before/i.test(q)) {
    if (issues.length === 0) {
      return 'I could not find similar historical tickets in the index. Try running **Admin → Sync** or `npm run seed:demo` to load demo data.';
    }
    return [
      `Yes — this pattern looks similar to **${issues.length}** past incident(s).`,
      '',
      `Closest match: **${topIssue?.id}**`,
      topIssue?.content.slice(0, 400) + '...',
      '',
      '**Recommendation:** Compare stack traces and deployment timing with the referenced tickets.',
    ].join('\n');
  }

  if (/root cause|why|cause/i.test(q)) {
    const cause = topIssue?.metadata?.rootCause || 'Likely related to a recent configuration or deployment change.';
    return [
      '## Probable root cause',
      '',
      cause,
      '',
      issues.length
        ? `Based on **${issues[0]?.id}** and ${issues.length - 1} other similar resolved tickets.`
        : 'Run AI analysis on the ticket detail page for a fuller breakdown.',
    ].join('\n');
  }

  if (/debug|step|investigate|checklist/i.test(q)) {
    return [
      '## Suggested debugging steps',
      '',
      '1. Reproduce in staging with the same user role and data volume',
      '2. Check application logs 15 minutes before first report',
      '3. Review recent merges to the affected service',
      '4. Compare config with last known-good deployment',
      '5. Verify third-party dependencies (auth, cache, DB pool)',
      '',
      issues[0]
        ? `Reference fix from **${issues[0].id}**: ${issues[0].metadata?.resolution || 'see ticket resolution notes'}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (/fix|resolved|last time/i.test(q)) {
    if (!topIssue) return 'No matching resolutions in the knowledge base yet. Seed demo data or sync from Jira.';
    return [
      `## What fixed it last time (${topIssue.id})`,
      '',
      topIssue.metadata?.resolution || topIssue.content.slice(0, 500),
      '',
      'Apply the same remediation if your environment matches the historical incident.',
    ].join('\n');
  }

  if (/summarize|summary/i.test(q)) {
    return [
      '## Summary of similar incidents',
      '',
      ...issues.slice(0, 3).map(
        (iss, i) =>
          `**${i + 1}. ${iss.id}** — ${iss.metadata?.title || 'Related ticket'}\n${iss.metadata?.resolution?.slice(0, 120) || iss.content.slice(0, 120)}...`
      ),
      '',
      issues.length === 0 ? '_No indexed tickets — use demo seed for testing._' : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '## Jira Intelligence Assistant (demo mode)',
    '',
    `You asked: _${question.slice(0, 200)}_`,
    '',
    issues.length
      ? `I found **${issues.length}** relevant historical ticket(s). Top match: **${topIssue?.id}**.`
      : 'No vector matches yet — run `npm run seed:demo` in the backend folder.',
    '',
    '**Tip:** Set `AI_PROVIDER=gitlab` with `GITLAB_URL` and `GITLAB_TOKEN` to use GitLab Duo for real responses.',
    '',
    'Try quick prompts: root cause, debugging steps, similar incidents, or what fixed it last time.',
  ].join('\n');
}
