import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { listTickets, getTicketById, getTicketComments, getLatestRecommendation, findSimilarTickets, analyzeAndRecommend, } from '../services/ticket.service.js';
import { fetchTicketFromJira, getJiraConfigForUser } from '../services/jira.service.js';
import { query } from '../db/pool.js';
const router = Router();
router.use(authMiddleware);
router.get('/', async (req, res) => {
    const { status, search, limit, offset } = req.query;
    const result = await listTickets({
        status: status,
        search: search,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(result);
});
router.get('/similar', async (req, res) => {
    const ticketId = req.query.ticketId;
    const topK = req.query.topK ? parseInt(req.query.topK, 10) : 5;
    if (!ticketId)
        return res.status(400).json({ error: 'ticketId required' });
    const similar = await findSimilarTickets(ticketId, topK);
    res.json({ similar });
});
router.post('/import', async (req, res) => {
    const { jiraKey } = req.body;
    if (!jiraKey)
        return res.status(400).json({ error: 'jiraKey required' });
    const cfg = await getJiraConfigForUser(req.user.id);
    if (!cfg)
        return res.status(400).json({ error: 'Jira not configured' });
    try {
        const parsed = await fetchTicketFromJira(req.user.id, jiraKey);
        const existing = await query('SELECT id FROM jira_tickets WHERE jira_key = $1', [parsed.jiraKey]);
        if (existing.rows[0]) {
            return res.json({ ticketId: existing.rows[0].id, imported: false });
        }
        const ins = await query(`INSERT INTO jira_tickets (
        jira_key, jira_id, title, description, status, priority, labels,
        assignee, reporter, issue_type, resolution, resolution_notes, final_fix,
        resolution_time_hours, created_at_jira, resolved_at_jira
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [
            parsed.jiraKey,
            parsed.jiraId,
            parsed.title,
            parsed.description,
            parsed.status,
            parsed.priority,
            parsed.labels,
            parsed.assignee,
            parsed.reporter,
            parsed.issueType,
            parsed.resolution,
            parsed.resolutionNotes,
            parsed.finalFix,
            parsed.resolutionTimeHours,
            parsed.createdAtJira,
            parsed.resolvedAtJira,
        ]);
        res.status(201).json({ ticketId: ins.rows[0].id, imported: true });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed';
        res.status(500).json({ error: message });
    }
});
router.get('/:id', async (req, res) => {
    const ticket = await getTicketById(req.params.id);
    if (!ticket)
        return res.status(404).json({ error: 'Ticket not found' });
    const [comments, recommendation, relationships] = await Promise.all([
        getTicketComments(ticket.id),
        getLatestRecommendation(ticket.id),
        query(`SELECT tr.*, jt.jira_key, jt.title, jt.status, jt.final_fix
       FROM ticket_relationships tr
       JOIN jira_tickets jt ON jt.id = tr.related_ticket_id
       WHERE tr.source_ticket_id = $1 ORDER BY tr.similarity_score DESC LIMIT 10`, [ticket.id]),
    ]);
    res.json({ ticket, comments, recommendation, relationships: relationships.rows });
});
router.get('/:id/similar', async (req, res) => {
    const topK = req.query.topK ? parseInt(req.query.topK, 10) : 5;
    try {
        const similar = await findSimilarTickets(req.params.id, topK);
        res.json({ similar });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Search failed';
        res.status(500).json({ error: message });
    }
});
router.post('/:id/analyze', async (req, res) => {
    const ticketId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    try {
        const result = await analyzeAndRecommend(ticketId, req.user?.id);
        res.json(result);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Analysis failed';
        res.status(500).json({ error: message });
    }
});
export default router;
