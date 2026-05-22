import { query } from '../db/pool.js';
import { aiClient } from '../lib/ai-client.js';
import { getTicketById, getTicketComments, getDatabaseContextForChat } from './ticket.service.js';

export async function createSession(userId: string, ticketId?: string, title?: string) {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO chat_sessions (user_id, ticket_id, title)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, ticketId || null, title || 'New Chat']
  );
  return rows[0].id;
}

export async function getSessions(userId: string) {
  const { rows } = await query(
    `SELECT cs.*, jt.jira_key, jt.title as ticket_title
     FROM chat_sessions cs
     LEFT JOIN jira_tickets jt ON jt.id = cs.ticket_id
     WHERE cs.user_id = $1 ORDER BY cs.updated_at DESC`,
    [userId]
  );
  return rows;
}

export async function getSessionMessages(sessionId: string) {
  const { rows } = await query(
    'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId]
  );
  return rows;
}

export async function processChatQuery(opts: {
  userId: string;
  message: string;
  sessionId?: string;
  ticketId?: string;
}) {
  let sessionId = opts.sessionId;

  if (!sessionId) {
    sessionId = await createSession(opts.userId, opts.ticketId);
  }

  let ticketContext = '';
  if (opts.ticketId) {
    const ticket = await getTicketById(opts.ticketId);
    if (ticket) {
      const comments = await getTicketComments(opts.ticketId);
      ticketContext = [
        `Jira Key: ${ticket.jira_key}`,
        `Title: ${ticket.title}`,
        `Status: ${ticket.status}`,
        `Description: ${ticket.description || 'N/A'}`,
        `Resolution: ${ticket.resolution || 'N/A'}`,
        `Comments:\n${comments.map((c) => `- ${c.author}: ${c.body}`).join('\n')}`,
      ].join('\n');
    }
  }

  const historyRows = await getSessionMessages(sessionId);
  const history = historyRows.slice(-10).map((m) => ({
    role: m.role as string,
    content: m.content as string,
  }));

  await query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
    [sessionId, opts.message]
  );

  const dbContext = await getDatabaseContextForChat(opts.message);

  const result = await aiClient.chat({
    message: opts.message,
    ticketId: opts.ticketId,
    ticketContext,
    dbContext: dbContext.context,
    dbStats: {
      totalTickets: dbContext.totalInDatabase,
      ticketsInPrompt: dbContext.ticketsIncluded,
    },
    history,
  });

  await query(
    `INSERT INTO chat_messages (session_id, role, content, metadata)
     VALUES ($1, 'assistant', $2, $3)`,
    [sessionId, result.answer, JSON.stringify({ sources: result.sources })]
  );

  await query('UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1', [sessionId]);

  await query(
    `INSERT INTO analytics_events (user_id, event_type, ticket_id, metadata)
     VALUES ($1, 'chat_query', $2, $3)`,
    [opts.userId, opts.ticketId || null, JSON.stringify({ sessionId })]
  );

  return { sessionId, answer: result.answer, sources: result.sources };
}
