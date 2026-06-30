import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly, AuthRequest } from '../middleware/auth.js';
import { syncJiraTickets, saveJiraConfig, getJiraConfigForUser, getJiraConfigFromEnv, testJiraConnection } from '../services/jira.service.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authMiddleware);

const configSchema = z
  .object({
    baseUrl: z.string().url(),
    username: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    apiToken: z.string().optional(),
    projectKey: z.string().optional(),
    deploymentType: z.enum(['cloud', 'server']).optional(),
    syncFilter: z.enum(['resolved', 'closed', 'both']).optional(),
    insecureSsl: z.boolean().optional(),
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
    syncFilter: data.syncFilter || 'resolved',
    insecureSsl: data.insecureSsl,
  }));

const testConnectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  username: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  apiToken: z.string().optional(),
  projectKey: z.string().optional(),
  deploymentType: z.enum(['cloud', 'server']).optional(),
  syncFilter: z.enum(['resolved', 'closed', 'both']).optional(),
  insecureSsl: z.boolean().optional(),
});

router.get('/config', async (req: AuthRequest, res) => {
  const env = getJiraConfigFromEnv();
  const userCfg = await getJiraConfigForUser(req.user!.id);
  const lastSync = await query(
    'SELECT last_sync_at, sync_status FROM jira_config WHERE user_id = $1',
    [req.user!.id]
  );

  const dbRow = await query<{
    base_url: string;
    project_key: string;
    deployment_type: string | null;
    sync_filter: string | null;
  }>(
    'SELECT base_url, project_key, deployment_type, sync_filter FROM jira_config WHERE user_id = $1 LIMIT 1',
    [req.user!.id]
  );
  const dbCfg = dbRow.rows[0];

  const syncFilterLabels: Record<string, string> = {
    resolved: 'Resolved (has resolution)',
    closed: 'Closed status',
    both: 'Resolved or Closed',
  };

  res.json({
    configured: !!userCfg,
    source: dbCfg ? 'database' : env ? 'environment' : null,
    deploymentType: userCfg?.deploymentType || 'server',
    projectKey: userCfg?.projectKey,
    baseUrl: userCfg?.baseUrl,
    syncFilter: userCfg?.syncFilter || 'resolved',
    syncFilterLabel: syncFilterLabels[userCfg?.syncFilter || 'resolved'],
    insecureSsl: userCfg?.insecureSsl === true,
    username: userCfg?.username,
    lastSyncAt: lastSync.rows[0]?.last_sync_at,
    syncStatus: lastSync.rows[0]?.sync_status || 'idle',
  });
});

router.put('/config', adminOnly, async (req: AuthRequest, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let data = parsed.data;
  if (!data.apiToken?.trim()) {
    const existing = await getJiraConfigForUser(req.user!.id);
    if (!existing?.apiToken) {
      return res.status(400).json({ error: 'Password or API token is required for new Jira configuration' });
    }
    data = { ...data, apiToken: existing.apiToken };
  }

  await saveJiraConfig(req.user!.id, data);
  res.json({ success: true });
});

router.post('/test-connection', adminOnly, async (req: AuthRequest, res) => {
  const parsed = testConnectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const body = parsed.data;
  const result = await testJiraConnection(req.user!.id, {
    baseUrl: body.baseUrl?.replace(/\/$/, ''),
    username: body.username || body.email,
    apiToken: body.apiToken,
    projectKey: body.projectKey,
    deploymentType: body.deploymentType,
    syncFilter: body.syncFilter,
    insecureSsl: body.insecureSsl,
  });

  res.json(result);
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
