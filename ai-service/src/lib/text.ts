export function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTicketDocument(payload: {
  title: string;
  description: string;
  comments: string[];
  resolution: string;
  labels: string[];
  jiraKey?: string;
}): string {
  const parts = [
    payload.jiraKey ? `Ticket: ${payload.jiraKey}` : '',
    `Title: ${cleanText(payload.title)}`,
    `Description: ${cleanText(payload.description)}`,
    payload.labels.length ? `Labels: ${payload.labels.join(', ')}` : '',
    payload.comments.length
      ? `Comments:\n${payload.comments.map((c) => cleanText(c)).join('\n')}`
      : '',
    payload.resolution ? `Resolution: ${cleanText(payload.resolution)}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}
