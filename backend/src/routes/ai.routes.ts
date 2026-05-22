import { Router } from 'express';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';

const router = Router();
router.use(authMiddleware);

router.get('/status', async (_req, res) => {
  try {
    const { data } = await axios.get(`${config.aiServiceUrl}/health`, { timeout: 5000 });
    res.json(data);
  } catch {
    res.status(503).json({
      status: 'unavailable',
      aiReady: false,
      setupMessage: 'AI service is not running. Start it: cd ai-service && npm run dev',
      provider: 'unknown',
      hardcodedMock: false,
    });
  }
});

export default router;
