/** Minimum cosine similarity to include a ticket as a RAG source */
export const MIN_SIMILARITY = 0.12;
const GREETINGS = /^(hi|hey|hello|howdy|good\s+(morning|afternoon|evening)|what'?s\s+up|sup)[\s!?.,]*$/i;
export function isGreeting(message) {
    return GREETINGS.test(message.trim());
}
export function isSubstantiveQuestion(message) {
    const t = message.trim();
    if (t.length < 8)
        return false;
    if (isGreeting(t))
        return false;
    return true;
}
/** Turn raw JSON analysis into readable markdown for chat UI */
export function formatChatAnswer(raw) {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*"probableRootCause"[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const j = JSON.parse(jsonMatch[0]);
            const steps = Array.isArray(j.recommendedSteps) ? j.recommendedSteps : [];
            const checklist = Array.isArray(j.investigationChecklist)
                ? j.investigationChecklist
                : [];
            const fixes = Array.isArray(j.possibleFixes) ? j.possibleFixes : [];
            const confidence = typeof j.confidenceScore === 'number'
                ? `\n\n*Confidence: ${(j.confidenceScore * 100).toFixed(0)}%*`
                : '';
            return [
                '## Probable root cause',
                String(j.probableRootCause || 'Unknown'),
                '',
                '## Likely resolution',
                String(j.likelyResolution || 'See similar tickets below.'),
                '',
                steps.length ? '## Recommended steps\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '',
                '',
                checklist.length
                    ? '## Investigation checklist\n' + checklist.map((s) => `- ${s}`).join('\n')
                    : '',
                '',
                fixes.length ? '## Possible fixes\n' + fixes.map((s) => `- ${s}`).join('\n') : '',
                confidence,
            ]
                .filter(Boolean)
                .join('\n');
        }
        catch {
            /* not valid json */
        }
    }
    return trimmed;
}
export function greetingReply(dbStats) {
    const countNote = dbStats && dbStats.totalTickets > 0
        ? `\n\nI have access to **${dbStats.totalTickets} tickets** in your database.`
        : '\n\n*(No tickets in database yet — run `npm run seed:demo` or sync from Jira.)*';
    return [
        "Hi! I'm your **Jira Intelligence** assistant.",
        countNote,
        '',
        'I read from your **PostgreSQL ticket database**. Try asking:',
        '- *Have we seen duplicate charges before?*',
        '- *What fixed DEMO-106?*',
        '- *What is the probable root cause for API timeouts?*',
    ].join('\n');
}
