import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly, AuthRequest } from '../middleware/auth.js';
import { syncJiraTickets, saveJiraConfig, getJiraConfigForUser, getJiraConfigFromEnv } from '../services/jira.service.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authMiddleware);

const configSchema = z
  .object({
    baseUrl: z.string().url(),
    username: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    apiToken: z.string().min(1),
    projectKey: z.string().optional(),
    deploymentType: z.enum(['cloud', 'server']).optional(),
  })
  .refine((data) => !!(data.username || data.email), {
    message: 'username is required',
    path: ['username'],
  })
  .transform((data) => ({
    baseUrl: data.baseUrl.replace(/\/$/, ''),
    username: (data.username || data.email)!,
    apiToken: data.apiToken,
    projectKey: data.projectKey,
    deploymentType: data.deploymentType || 'server',
  }));

router.get('/config', async (req: AuthRequest, res) => {
  const env = getJiraConfigFromEnv();
  const userCfg = await getJiraConfigForUser(req.user!.id);
  const lastSync = await query(
    'SELECT last_sync_at, sync_status FROM jira_config WHERE user_id = $1',
    [req.user!.id]
  );

  res.json({
    configured: !!(env || userCfg),
    source: env ? 'environment' : userCfg ? 'database' : null,
    deploymentType: env?.deploymentType || userCfg?.deploymentType || 'server',
    projectKey: env?.projectKey || userCfg?.projectKey,
    baseUrl: env?.baseUrl || userCfg?.baseUrl,
    lastSyncAt: lastSync.rows[0]?.last_sync_at,
    syncStatus: lastSync.rows[0]?.sync_status || 'idle',
  });
});

router.put('/config', adminOnly, async (req: AuthRequest, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await saveJiraConfig(req.user!.id, parsed.data);
  res.json({ success: true });
});

router.post('/sync', adminOnly, async (req: AuthRequest, res) => {
  try {
    const result = await syncJiraTickets(req.user!.id);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    res.status(500).json({ error: message });
  }
});

router.get('/sync/logs', async (_req, res) => {
  const { rows } = await query(
    'SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20'
  );
  res.json({ logs: rows });
});

export default router;
