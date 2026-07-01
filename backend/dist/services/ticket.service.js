import { query } from '../db/pool.js';
import { aiClient } from '../lib/ai-client.js';
import { cacheGet, cacheSet } from '../lib/redis.js';
export async function listTickets(opts) {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const params = [];
    let where = 'WHERE 1=1';
    if (opts.status) {
        params.push(opts.status);
        where += ` AND status ILIKE $${params.length}`;
    }
    if (opts.search) {
        params.push(`%${opts.search}%`);
        where += ` AND (title ILIKE $${params.length} OR jira_key ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    params.push(limit, offset);
    const { rows } = await query(`SELECT * FROM jira_tickets ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const countResult = await query(`SELECT COUNT(*)::text as count FROM jira_tickets ${where}`, params.slice(0, -2));
    return { tickets: rows, total: parseInt(countResult.rows[0]?.count || '0', 10) };
}
/** Load ticket text from PostgreSQL for Duo when vector index is empty or weak */
export async function getDatabaseContextForChat(message, limit = 8) {
    const words = message
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['have', 'what', 'when', 'where', 'this', 'that', 'with', 'from', 'been', 'before'].includes(w));
    let rows = [];
    if (words.length > 0) {
        const pattern = `%${words.slice(0, 5).join('%')}%`;
        const result = await query(`SELECT * FROM jira_tickets
       WHERE title ILIKE $1 OR description ILIKE $1 OR jira_key ILIKE $1
          OR $2 = ANY(error_keywords) OR category ILIKE $1 OR root_cause ILIKE $1
       ORDER BY updated_at DESC LIMIT $3`, [pattern, words[0], limit]);
        rows = result.rows;
    }
    if (rows.length < 3) {
        const recent = await query(`SELECT * FROM jira_tickets ORDER BY updated_at DESC LIMIT $1`, [limit]);
        const seen = new Set(rows.map((r) => r.id));
        for (const t of recent.rows) {
            if (!seen.has(t.id))
                rows.push(t);
        }
    }
    const blocks = [];
    for (const t of rows.slice(0, limit)) {
        const comments = await query('SELECT author, body FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at_jira ASC LIMIT 5', [t.id]);
        blocks.push([
            `### ${t.jira_key}: ${t.title}`,
            `Status: ${t.status} | Category: ${t.category || 'N/A'} | Module: ${t.affected_module || 'N/A'}`,
            `Description: ${(t.description || '').slice(0, 600)}`,
            t.root_cause ? `Root cause: ${t.root_cause}` : '',
            t.final_fix || t.resolution_notes ? `Resolution: ${t.final_fix || t.resolution_notes}` : '',
            comments.rows.length
                ? `Comments:\n${comments.rows.map((c) => `- ${c.author}: ${c.body.slice(0, 200)}`).join('\n')}`
                : '',
        ]
            .filter(Boolean)
            .join('\n'));
    }
    const count = await query('SELECT COUNT(*)::text as count FROM jira_tickets');
    return {
        totalInDatabase: parseInt(count.rows[0]?.count || '0', 10),
        ticketsIncluded: blocks.length,
        context: blocks.join('\n\n'),
    };
}
export async function getTicketById(id) {
    const { rows } = await query('SELECT * FROM jira_tickets WHERE id = $1', [id]);
    return rows[0] || null;
}
export async function getTicketByJiraKey(key) {
    const { rows } = await query('SELECT * FROM jira_tickets WHERE jira_key = $1', [key]);
    return rows[0] || null;
}
export async function getTicketComments(ticketId) {
    const { rows } = await query('SELECT * FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at_jira ASC', [ticketId]);
    return rows;
}
export async function getLatestRecommendation(ticketId) {
    const { rows } = await query('SELECT * FROM ai_recommendations WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1', [ticketId]);
    return rows[0] || null;
}
export async function findSimilarTickets(ticketId, topK = 5) {
    const ticket = await getTicketById(ticketId);
    if (!ticket)
        throw new Error('Ticket not found');
    const comments = await getTicketComments(ticketId);
    const queryText = [
        ticket.title,
        ticket.description || '',
        ...comments.map((c) => c.body),
    ].join('\n');
    const results = await aiClient.searchSimilar({
        ticketId,
        queryText,
        topK: topK + 1,
        resolvedOnly: true,
    });
    const similar = [];
    for (const r of results) {
        if (r.ticketId === ticketId)
            continue;
        const related = await getTicketById(r.ticketId);
        if (!related)
            continue;
        await query(`INSERT INTO ticket_relationships (source_ticket_id, related_ticket_id, similarity_score)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_ticket_id, related_ticket_id)
       DO UPDATE SET similarity_score = $3`, [ticketId, r.ticketId, r.similarityScore]);
        similar.push({
            ticket: related,
            similarity_score: r.similarityScore,
            resolution_summary: r.resolutionSummary || related.final_fix || related.resolution_notes,
        });
        if (similar.length >= topK)
            break;
    }
    return similar;
}
export async function analyzeAndRecommend(ticketId, userId) {
    const ticket = await getTicketById(ticketId);
    if (!ticket)
        throw new Error('Ticket not found');
    const comments = await getTicketComments(ticketId);
    const commentBodies = comments.map((c) => c.body);
    const analysis = await aiClient.analyzeTicket({
        title: ticket.title,
        description: ticket.description || '',
        comments: commentBodies,
    });
    await query(`UPDATE jira_tickets SET
      issue_type=$2, affected_module=$3, error_keywords=$4,
      severity=$5, category=$6, updated_at=NOW()
     WHERE id=$1`, [
        ticketId,
        analysis.issueType,
        analysis.affectedModule,
        analysis.errorKeywords,
        analysis.severity,
        analysis.category,
    ]);
    await aiClient.embedTicket({
        ticketId,
        jiraKey: ticket.jira_key,
        title: ticket.title,
        description: ticket.description || '',
        comments: commentBodies,
        resolution: [ticket.resolution_notes, ticket.final_fix].filter(Boolean).join('\n'),
        labels: ticket.labels || [],
    });
    const similarResults = await aiClient.searchSimilar({
        ticketId,
        queryText: `${ticket.title}\n${ticket.description}`,
        topK: 5,
        resolvedOnly: true,
    });
    const recommendation = await aiClient.generateRecommendation({
        ticketId,
        title: ticket.title,
        description: ticket.description || '',
        similarTickets: similarResults.filter((s) => s.ticketId !== ticketId),
    });
    const similarIds = similarResults
        .map((s) => s.ticketId)
        .filter((id) => id !== ticketId);
    const rec = await query(`INSERT INTO ai_recommendations (
      ticket_id, probable_root_cause, recommended_steps, likely_resolution,
      investigation_checklist, possible_fixes, confidence_score, similar_ticket_ids, model_used
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
        ticketId,
        recommendation.probableRootCause,
        JSON.stringify(recommendation.recommendedSteps),
        recommendation.likelyResolution,
        JSON.stringify(recommendation.investigationChecklist),
        JSON.stringify(recommendation.possibleFixes),
        recommendation.confidenceScore,
        similarIds,
        process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
    ]);
    if (userId) {
        await query(`INSERT INTO analytics_events (user_id, event_type, ticket_id, metadata)
       VALUES ($1, 'ai_analysis', $2, $3)`, [userId, ticketId, JSON.stringify({ confidence: recommendation.confidenceScore })]);
    }
    return {
        analysis,
        recommendation: rec.rows[0],
        similar: await findSimilarTickets(ticketId),
    };
}
export async function getAnalyticsSummary() {
    const cacheKey = 'analytics:summary';
    const cached = await cacheGet(cacheKey);
    if (cached)
        return JSON.parse(cached);
    const [ticketStats, recurring, avgResolution, topCauses, aiUsage] = await Promise.all([
        query(`SELECT
        COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE resolution IS NULL AND status NOT ILIKE '%done%')::text as open_count,
        COUNT(*) FILTER (WHERE resolution IS NOT NULL OR resolved_at_jira IS NOT NULL)::text as resolved_count
       FROM jira_tickets`),
        query(`SELECT COALESCE(category, issue_type, 'Uncategorized') as category, COUNT(*)::text as count
       FROM jira_tickets GROUP BY 1 ORDER BY count::int DESC LIMIT 10`),
        query(`SELECT ROUND(AVG(resolution_time_hours)::numeric, 2)::text as avg_hours
       FROM jira_tickets WHERE resolution_time_hours IS NOT NULL`),
        query(`SELECT probable_root_cause as root_cause, COUNT(*)::text as count
       FROM ai_recommendations WHERE probable_root_cause IS NOT NULL
       GROUP BY 1 ORDER BY count::int DESC LIMIT 10`),
        query(`SELECT COUNT(*)::text as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::text as last_7_days
       FROM analytics_events WHERE event_type IN ('ai_analysis', 'chat_query')`),
    ]);
    const recent = await query(`SELECT id, jira_key, title, status, priority, updated_at
     FROM jira_tickets ORDER BY updated_at DESC LIMIT 10`);
    const summary = {
        tickets: {
            total: parseInt(ticketStats.rows[0]?.total || '0', 10),
            open: parseInt(ticketStats.rows[0]?.open_count || '0', 10),
            resolved: parseInt(ticketStats.rows[0]?.resolved_count || '0', 10),
        },
        recentTickets: recent.rows,
        recurringIssues: recurring.rows.map((r) => ({
            category: r.category,
            count: parseInt(r.count, 10),
        })),
        averageResolutionHours: parseFloat(avgResolution.rows[0]?.avg_hours || '0'),
        topRootCauses: topCauses.rows.map((r) => ({
            cause: r.root_cause,
            count: parseInt(r.count, 10),
        })),
        aiUsage: {
            total: parseInt(aiUsage.rows[0]?.total || '0', 10),
            last7Days: parseInt(aiUsage.rows[0]?.last_7_days || '0', 10),
        },
    };
    await cacheSet(cacheKey, JSON.stringify(summary), 60);
    return summary;
}
