import { Router } from 'express';
import { z } from 'zod';
import { isAxiosError } from 'axios';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getGitHubCodeConfigForUser, getGitHubCodeConfigFromEnv, saveGitHubCodeConfig, testGitHubCodeConnection, listAccessibleRepos, listScannableFiles, runSecurityScan, listSecurityScans, getSecurityScan, listScanFindings, getSecurityDashboardStats, } from '../services/github-code.service.js';
import { query } from '../db/pool.js';
const router = Router();
router.use(authMiddleware);
const configSchema = z.object({
    token: z.string().optional(),
    defaultOwner: z.string().optional(),
});
const testConnectionSchema = z.object({
    token: z.string().optional(),
    defaultOwner: z.string().optional(),
});
const scanSchema = z.object({
    repoFullName: z.string().min(1),
    branch: z.string().optional(),
    filePath: z.string().min(1),
});
router.get('/config', async (req, res) => {
    const env = getGitHubCodeConfigFromEnv();
    const userCfg = await getGitHubCodeConfigForUser(req.user.id);
    const dbRow = await query('SELECT default_owner, last_scan_at, scan_status FROM github_code_config WHERE user_id = $1 LIMIT 1', [req.user.id]);
    let login;
    if (userCfg) {
        const test = await testGitHubCodeConnection(req.user.id);
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
    let data = parsed.data;
    if (!data.token?.trim()) {
        const existing = await getGitHubCodeConfigForUser(req.user.id);
        if (!existing?.token) {
            return res.status(400).json({ error: 'GitHub token is required for new configuration' });
        }
        await saveGitHubCodeConfig(req.user.id, {
            token: existing.token,
            defaultOwner: data.defaultOwner,
        });
    }
    else {
        await saveGitHubCodeConfig(req.user.id, {
            token: data.token,
            defaultOwner: data.defaultOwner,
        });
    }
    res.json({ success: true });
});
router.post('/test-connection', adminOnly, async (req, res) => {
    const parsed = testConnectionSchema.safeParse(req.body ?? {});
    if (!parsed.success)
        return res.status(400).json({ error: parsed.error.flatten() });
    const result = await testGitHubCodeConnection(req.user.id, {
        token: parsed.data.token,
        defaultOwner: parsed.data.defaultOwner,
    });
    res.json(result);
});
router.get('/repos', async (req, res) => {
    try {
        const cfg = await getGitHubCodeConfigForUser(req.user.id);
        if (!cfg)
            return res.status(400).json({ error: 'GitHub is not configured' });
        const repos = await listAccessibleRepos(cfg);
        res.json({ repos });
    }
    catch (err) {
        const message = isAxiosError(err)
            ? String(err.response?.data?.message || err.message)
            : err instanceof Error
                ? err.message
                : 'Failed to list repositories';
        console.error('[github/repos]', message);
        res.status(502).json({ error: message });
    }
});
router.get('/repos/:owner/:repo/files', async (req, res) => {
    try {
        const cfg = await getGitHubCodeConfigForUser(req.user.id);
        if (!cfg)
            return res.status(400).json({ error: 'GitHub is not configured' });
        const owner = Array.isArray(req.params.owner) ? req.params.owner[0] : req.params.owner;
        const repo = Array.isArray(req.params.repo) ? req.params.repo[0] : req.params.repo;
        const branch = req.query.branch ? String(req.query.branch) : 'main';
        const repoFullName = `${owner}/${repo}`;
        const result = await listScannableFiles(cfg, repoFullName, branch);
        res.json({ files: result.files, sha: result.sha });
    }
    catch (err) {
        const message = isAxiosError(err)
            ? String(err.response?.data?.message || err.message)
            : err instanceof Error
                ? err.message
                : 'Failed to list files';
        console.error('[github/files]', message);
        res.status(502).json({ error: message });
    }
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
