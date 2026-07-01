import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { processChatQuery, getSessions, getSessionMessages, createSession } from '../services/chat.service.js';
const router = Router();
router.use(authMiddleware);
const querySchema = z.object({
    message: z.string().min(1),
    sessionId: z.string().uuid().optional(),
    ticketId: z.string().uuid().optional(),
});
router.post('/query', async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    try {
        const result = await processChatQuery({
            userId: req.user.id,
            ...parsed.data,
        });
        res.json(result);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Chat failed';
        res.status(500).json({ error: message });
    }
});
router.get('/sessions', async (req, res) => {
    const sessions = await getSessions(req.user.id);
    res.json({ sessions });
});
router.post('/sessions', async (req, res) => {
    const { ticketId, title } = req.body;
    const id = await createSession(req.user.id, ticketId, title);
    res.status(201).json({ sessionId: id });
});
router.get('/sessions/:id/messages', async (req, res) => {
    const messages = await getSessionMessages(req.params.id);
    res.json({ messages });
});
export default router;
