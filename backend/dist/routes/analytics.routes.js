import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getAnalyticsSummary } from '../services/ticket.service.js';
const router = Router();
router.use(authMiddleware);
router.get('/summary', async (_req, res) => {
    try {
        const summary = await getAnalyticsSummary();
        res.json(summary);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Analytics failed';
        res.status(500).json({ error: message });
    }
});
export default router;
