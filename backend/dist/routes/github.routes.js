import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getGitHubConfigForUser, getGitHubConfigFromEnv, saveGitHubConfig, testGitHubConnection, listAccessibleRepos, runSecurityScan, listSecurityScans, getSecurityScan, listScanFindings, getSecurityDashboardStats, } from '../services/github.service.js';
import { query } from '../db/pool.js';
const router = Router();
router.use(authMiddleware);
const configSchema = z.object({
    token: z.string().min(1),
    defaultOwner: z.string().optional(),
});
const testConnectionSchema = z.object({
    token: z.string().optional(),
    defaultOwner: z.string().optional(),
});
const scanSchema = z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    branch: z.string().optional(),
});
router.get('/config', async (req, res) => {
    const env = getGitHubConfigFromEnv();
    const userCfg = await getGitHubConfigForUser(req.user.id);
    const dbRow = await query('SELECT default_owner, last_scan_at, scan_status FROM github_config WHERE user_id = $1 LIMIT 1', [req.user.id]);
    let login;
    if (userCfg) {
        const test = await testGitHubConnection(req.user.id);
        login = test.details.login;
    }
    res.json({
        configured: !!userCfg,
        source: dbRow.rows[0] ? 'database' : env ? 'environment' : null,
        defaultOwner: userCfg?.defaultOwner,
        login,
        lastScanAt: dbRow.rows[0]?.last_scan_at?.toISOString() || null,
        scanStatus: dbRow.rows[0]?.scan_status || 'idle',
    });
});
router.put('/config', adminOnly, async (req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    await saveGitHubConfig(req.user.id, parsed.data);
    res.json({ success: true });
});
router.post('/test-connection', adminOnly, async (req, res) => {
    const parsed = testConnectionSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const result = await testGitHubConnection(req.user.id, {
        token: parsed.data.token,
        defaultOwner: parsed.data.defaultOwner,
    });
    res.json(result);
});
router.get('/repos', async (req, res) => {
    const cfg = await getGitHubConfigForUser(req.user.id);
    if (!cfg)
        return res.status(400).json({ error: 'GitHub is not configured' });
    const repos = await listAccessibleRepos(cfg.token, cfg.defaultOwner);
    res.json({ repos });
});
router.get('/dashboard', async (req, res) => {
    const stats = await getSecurityDashboardStats(req.user.id);
    res.json(stats);
});
router.post('/scan', adminOnly, async (req, res) => {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    try {
        const scan = await runSecurityScan(req.user.id, parsed.data);
        res.json(scan);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        res.status(500).json({ error: message });
    }
});
router.get('/scans', async (req, res) => {
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const offset = parseInt(String(req.query.offset || '0'), 10);
    const result = await listSecurityScans(req.user.id, { limit, offset });
    res.json(result);
});
router.get('/scans/:id', async (req, res) => {
    const scanId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const scan = await getSecurityScan(req.user.id, scanId);
    if (!scan)
        return res.status(404).json({ error: 'Scan not found' });
    res.json(scan);
});
router.get('/scans/:id/findings', async (req, res) => {
    const scanId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const severity = req.query.severity ? String(req.query.severity) : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const findings = await listScanFindings(req.user.id, scanId, { severity, category });
    if (findings.length === 0) {
        const scan = await getSecurityScan(req.user.id, scanId);
        if (!scan)
            return res.status(404).json({ error: 'Scan not found' });
    }
    res.json({ findings });
});
export default router;
