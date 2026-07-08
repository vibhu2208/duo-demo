import { Router } from 'express';
import { z } from 'zod';
import { isAxiosError } from 'axios';
import { authMiddleware, adminOnly, AuthRequest } from '../middleware/auth.js';
import {
  getGitLabCodeConfigForUser,
  getGitLabCodeConfigFromEnv,
  saveGitLabCodeConfig,
  testGitLabCodeConnection,
  listAccessibleProjects,
  listScannableFiles,
  runSecurityScan,
  listSecurityScans,
  getSecurityScan,
  listScanFindings,
  getSecurityDashboardStats,
} from '../services/gitlab-code.service.js';
import { query } from '../db/pool.js';

const router = Router();
router.use(authMiddleware);

const configSchema = z.object({
  baseUrl: z.string().url(),
  token: z.string().optional(),
  defaultGroup: z.string().optional(),
  insecureSsl: z.boolean().optional(),
});

const testConnectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  token: z.string().optional(),
  defaultGroup: z.string().optional(),
  insecureSsl: z.boolean().optional(),
});

const scanSchema = z.object({
  projectPath: z.string().min(1),
  branch: z.string().optional(),
  filePath: z.string().min(1),
});

router.get('/config', async (req: AuthRequest, res) => {
  const env = getGitLabCodeConfigFromEnv();
  const userCfg = await getGitLabCodeConfigForUser(req.user!.id);

  const dbRow = await query<{
    base_url: string;
    default_group: string | null;
    last_scan_at: Date | null;
    scan_status: string | null;
    insecure_ssl: boolean | null;
  }>(
    'SELECT base_url, default_group, last_scan_at, scan_status, insecure_ssl FROM gitlab_code_config WHERE user_id = $1 LIMIT 1',
    [req.user!.id]
  );

  let username: string | undefined;
  if (userCfg) {
    const test = await testGitLabCodeConnection(req.user!.id);
    username = test.details.username;
  }

  res.json({
    configured: !!userCfg,
    source: dbRow.rows[0] ? 'database' : env ? 'environment' : null,
    baseUrl: userCfg?.baseUrl,
    defaultGroup: userCfg?.defaultGroup,
    insecureSsl: userCfg?.insecureSsl === true,
    username,
    lastScanAt: dbRow.rows[0]?.last_scan_at?.toISOString() || null,
    scanStatus: dbRow.rows[0]?.scan_status || 'idle',
  });
});

router.put('/config', adminOnly, async (req: AuthRequest, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let data = parsed.data;
  if (!data.token?.trim()) {
    const existing = await getGitLabCodeConfigForUser(req.user!.id);
    if (!existing?.token) {
      return res.status(400).json({ error: 'GitLab token is required for new configuration' });
    }
    data = { ...data, token: existing.token };
  }

  await saveGitLabCodeConfig(req.user!.id, {
    baseUrl: data.baseUrl,
    token: data.token!,
    defaultGroup: data.defaultGroup,
    insecureSsl: data.insecureSsl,
  });
  res.json({ success: true });
});

router.post('/test-connection', adminOnly, async (req: AuthRequest, res) => {
  const parsed = testConnectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await testGitLabCodeConnection(req.user!.id, {
    baseUrl: parsed.data.baseUrl?.replace(/\/$/, ''),
    token: parsed.data.token,
    defaultGroup: parsed.data.defaultGroup,
    insecureSsl: parsed.data.insecureSsl,
  });
  res.json(result);
});

router.get('/projects', async (req: AuthRequest, res) => {
  try {
    const cfg = await getGitLabCodeConfigForUser(req.user!.id);
    if (!cfg) return res.status(400).json({ error: 'GitLab is not configured' });

    const projects = await listAccessibleProjects(cfg);
    res.json({ projects });
  } catch (err) {
    const message = isAxiosError(err)
      ? String((err.response?.data as { message?: string })?.message || err.message)
      : err instanceof Error
        ? err.message
        : 'Failed to list projects';
    console.error('[gitlab/projects]', message);
    res.status(502).json({ error: message });
  }
});

router.get('/projects/files', async (req: AuthRequest, res) => {
  try {
    const cfg = await getGitLabCodeConfigForUser(req.user!.id);
    if (!cfg) return res.status(400).json({ error: 'GitLab is not configured' });

    const projectPath = req.query.projectPath ? String(req.query.projectPath) : '';
    const branch = req.query.branch ? String(req.query.branch) : 'main';
    if (!projectPath) return res.status(400).json({ error: 'projectPath query parameter is required' });

    const result = await listScannableFiles(cfg, projectPath, branch);
    res.json({ files: result.files, sha: result.sha });
  } catch (err) {
    const message = isAxiosError(err)
      ? String((err.response?.data as { message?: string })?.message || err.message)
      : err instanceof Error
        ? err.message
        : 'Failed to list files';
    console.error('[gitlab/files]', message);
    res.status(502).json({ error: message });
  }
});

router.get('/dashboard', async (req: AuthRequest, res) => {
  const stats = await getSecurityDashboardStats(req.user!.id);
  res.json(stats);
});

router.post('/scan', adminOnly, async (req: AuthRequest, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const scan = await runSecurityScan(req.user!.id, parsed.data);
    res.json(scan);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    res.status(500).json({ error: message });
  }
});

router.get('/scans', async (req: AuthRequest, res) => {
  const limit = parseInt(String(req.query.limit || '20'), 10);
  const offset = parseInt(String(req.query.offset || '0'), 10);
  const result = await listSecurityScans(req.user!.id, { limit, offset });
  res.json(result);
});

router.get('/scans/:id', async (req: AuthRequest, res) => {
  const scanId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const scan = await getSecurityScan(req.user!.id, scanId);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  res.json(scan);
});

router.get('/scans/:id/findings', async (req: AuthRequest, res) => {
  const scanId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const severity = req.query.severity ? String(req.query.severity) : undefined;
  const category = req.query.category ? String(req.query.category) : undefined;
  const findings = await listScanFindings(req.user!.id, scanId, { severity, category });
  if (findings.length === 0) {
    const scan = await getSecurityScan(req.user!.id, scanId);
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
  }
  res.json({ findings });
});

export default router;
