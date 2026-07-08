import axios, { isAxiosError } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient } from '../lib/ai-client.js';
import { MAX_FILE_SIZE, detectLanguage, selectFilesForScan, } from './code-scan-utils.js';
const GITHUB_TOKEN_PLACEHOLDERS = ['ghp_your-token-here', 'your-token-here', 'ghp_xxx'];
function isPlaceholderToken(value) {
    const lower = value.toLowerCase();
    return GITHUB_TOKEN_PLACEHOLDERS.some((p) => lower.includes(p));
}
export function getGitHubCodeConfigFromEnv() {
    const { token, defaultOwner } = config.github;
    if (!token || isPlaceholderToken(token))
        return null;
    return { token, defaultOwner: defaultOwner || undefined };
}
async function getGitHubCodeConfigFromDb(userId) {
    const { rows } = await query('SELECT token_encrypted, default_owner FROM github_code_config WHERE user_id = $1 LIMIT 1', [userId]);
    if (!rows[0])
        return null;
    return {
        token: rows[0].token_encrypted,
        defaultOwner: rows[0].default_owner || undefined,
    };
}
export async function getGitHubCodeConfigForUser(userId) {
    const db = await getGitHubCodeConfigFromDb(userId);
    if (db)
        return db;
    return getGitHubCodeConfigFromEnv();
}
export async function saveGitHubCodeConfig(userId, data) {
    await query(`INSERT INTO github_code_config (user_id, token_encrypted, default_owner)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       token_encrypted = EXCLUDED.token_encrypted,
       default_owner = EXCLUDED.default_owner,
       updated_at = NOW()`, [userId, data.token, data.defaultOwner || null]);
}
export function createGitHubClient(cfg) {
    return axios.create({
        baseURL: 'https://api.github.com',
        headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 60000,
    });
}
export async function testGitHubCodeConnection(userId, overrides) {
    const saved = await getGitHubCodeConfigForUser(userId);
    const cfg = saved
        ? {
            ...saved,
            token: overrides?.token?.trim() ? overrides.token : saved.token,
            defaultOwner: overrides?.defaultOwner ?? saved.defaultOwner,
        }
        : overrides?.token
            ? { token: overrides.token, defaultOwner: overrides.defaultOwner }
            : null;
    const testedAt = new Date().toISOString();
    if (!cfg?.token) {
        return {
            ok: false,
            authorization: 'not_configured',
            message: 'GitHub is not configured. Set GITHUB_TOKEN (repo scope) in environment or admin settings.',
            details: { testedAt },
        };
    }
    try {
        const client = createGitHubClient(cfg);
        const { data: user, status } = await client.get('/user');
        let repoCount;
        try {
            const repos = await listAccessibleRepos(cfg);
            repoCount = repos.length;
        }
        catch {
            /* optional */
        }
        return {
            ok: true,
            authorization: 'success',
            httpStatus: status,
            message: `Connected to GitHub as ${user.name || user.login}`,
            details: {
                login: user.login,
                name: user.name || undefined,
                defaultOwner: cfg.defaultOwner,
                repoCount,
                testedAt,
            },
        };
    }
    catch (err) {
        const status = isAxiosError(err) ? err.response?.status : undefined;
        const detail = isAxiosError(err)
            ? String(err.response?.data?.message || err.message)
            : err instanceof Error
                ? err.message
                : 'Unknown error';
        const message = status === 401
            ? 'Authorization failed (HTTP 401): Invalid GitHub token. Use a PAT with repo scope.'
            : `Connection failed: ${detail}`;
        return {
            ok: false,
            authorization: 'failed',
            httpStatus: status,
            message,
            details: { testedAt },
        };
    }
}
export async function listAccessibleRepos(cfg) {
    const client = createGitHubClient(cfg);
    const repos = [];
    const seen = new Set();
    const addRepos = (data) => {
        for (const r of data) {
            if (seen.has(r.full_name))
                continue;
            seen.add(r.full_name);
            repos.push({
                fullName: r.full_name,
                name: r.name,
                owner: r.owner.login,
                defaultBranch: r.default_branch || 'main',
                private: r.private,
                description: r.description,
                webUrl: r.html_url,
            });
        }
    };
    const fetchPaged = async (path, params = {}) => {
        let page = 1;
        while (page <= 5) {
            const { data } = await client.get(path, { params: { ...params, per_page: 100, page } });
            if (!data.length)
                break;
            addRepos(data);
            if (data.length < 100)
                break;
            page++;
        }
    };
    if (cfg.defaultOwner) {
        try {
            await fetchPaged(`/orgs/${encodeURIComponent(cfg.defaultOwner)}/repos`, {
                type: 'all',
                sort: 'updated',
            });
        }
        catch (err) {
            if (!isAxiosError(err) || err.response?.status !== 404)
                throw err;
        }
    }
    await fetchPaged('/user/repos', {
        affiliation: 'owner,collaborator,organization_member',
        sort: 'updated',
    });
    return repos;
}
function parseRepoFullName(repoFullName) {
    const parts = repoFullName.split('/').filter(Boolean);
    if (parts.length < 2) {
        throw new Error('Repository must be in owner/repo format');
    }
    return { owner: parts[0], repo: parts.slice(1).join('/') };
}
export async function fetchRepoTree(client, repoFullName, branch) {
    const { owner, repo } = parseRepoFullName(repoFullName);
    const { data: branchData } = await client.get(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
    const sha = branchData.commit.sha;
    const { data: tree } = await client.get(`/repos/${owner}/${repo}/git/trees/${sha}`, { params: { recursive: '1' } });
    const entries = tree.tree
        .filter((item) => item.type === 'blob' || item.type === 'tree')
        .map((item) => ({
        path: item.path,
        type: item.type === 'tree' ? 'tree' : 'blob',
        size: item.size,
    }));
    if (tree.truncated) {
        console.warn(`[github-scan] tree truncated for ${repoFullName}@${branch}`);
    }
    return { sha, entries };
}
export async function listScannableFiles(cfg, repoFullName, branch) {
    const client = createGitHubClient(cfg);
    const { sha, entries } = await fetchRepoTree(client, repoFullName, branch);
    return { sha, files: selectFilesForScan(entries) };
}
export async function fetchFileContents(client, repoFullName, path, branch) {
    const { owner, repo } = parseRepoFullName(repoFullName);
    const { data } = await client.get(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
        params: { ref: branch },
    });
    if (data.size > MAX_FILE_SIZE) {
        throw new Error(`File ${path} exceeds size limit`);
    }
    if (data.encoding === 'base64') {
        return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    }
    return data.content;
}
function buildSeveritySummary(findings) {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
        const sev = f.severity in summary ? f.severity : 'info';
        summary[sev]++;
    }
    return summary;
}
function mapScanRow(row) {
    return {
        id: row.id,
        repoFullName: row.repo_full_name,
        branch: row.branch,
        commitSha: row.commit_sha,
        status: row.status,
        filesScanned: row.files_scanned,
        findingsCount: row.findings_count,
        severitySummary: row.severity_summary || {},
        summary: row.summary,
        errorMessage: row.error_message,
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at?.toISOString() || null,
    };
}
export async function runSecurityScan(userId, params) {
    const cfg = await getGitHubCodeConfigForUser(userId);
    if (!cfg)
        throw new Error('GitHub is not configured');
    const branch = params.branch || 'main';
    const repoFullName = params.repoFullName;
    const filePath = params.filePath.trim();
    if (!filePath)
        throw new Error('filePath is required — select one file to scan');
    const { rows: scanRows } = await query(`INSERT INTO security_scan_runs (user_id, repo_full_name, branch, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`, [userId, repoFullName, branch]);
    const scanId = scanRows[0].id;
    await query(`UPDATE github_code_config SET scan_status = 'running', updated_at = NOW() WHERE user_id = $1`, [userId]);
    try {
        const client = createGitHubClient(cfg);
        const { sha } = await fetchRepoTree(client, repoFullName, branch);
        const content = await fetchFileContents(client, repoFullName, filePath, branch);
        const files = [{ path: filePath, language: detectLanguage(filePath), content }];
        const reviewResult = await aiClient.reviewCode({
            files,
            repo: repoFullName,
            branch,
            mode: 'single-file-sections',
        });
        const severitySummary = buildSeveritySummary(reviewResult.findings);
        for (const f of reviewResult.findings) {
            await query(`INSERT INTO security_findings
         (scan_run_id, file_path, line_start, line_end, severity, category, title, description, recommendation, code_snippet, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
                scanId,
                f.filePath,
                f.lineStart ?? null,
                f.lineEnd ?? null,
                f.severity,
                f.category,
                f.title,
                f.description || null,
                f.recommendation || null,
                f.codeSnippet || null,
                f.confidence ?? null,
            ]);
        }
        const { rows: updated } = await query(`UPDATE security_scan_runs SET
         commit_sha = $2,
         status = 'completed',
         files_scanned = $3,
         findings_count = $4,
         severity_summary = $5,
         summary = $6,
         completed_at = NOW()
       WHERE id = $1
       RETURNING *`, [scanId, sha, 1, reviewResult.findings.length, JSON.stringify(severitySummary), reviewResult.summary]);
        await query(`UPDATE github_code_config SET scan_status = 'idle', last_scan_at = NOW(), updated_at = NOW() WHERE user_id = $1`, [userId]);
        return mapScanRow(updated[0]);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        await query(`UPDATE security_scan_runs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`, [scanId, message]);
        await query(`UPDATE github_code_config SET scan_status = 'idle', updated_at = NOW() WHERE user_id = $1`, [userId]);
        throw err;
    }
}
export async function listSecurityScans(userId, opts = {}) {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const { rows: countRows } = await query('SELECT COUNT(*)::text AS count FROM security_scan_runs WHERE user_id = $1', [userId]);
    const { rows } = await query(`SELECT * FROM security_scan_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
    return {
        scans: rows.map(mapScanRow),
        total: parseInt(countRows[0]?.count || '0', 10),
    };
}
export async function getSecurityScan(userId, scanId) {
    const { rows } = await query('SELECT * FROM security_scan_runs WHERE id = $1 AND user_id = $2 LIMIT 1', [scanId, userId]);
    if (!rows[0])
        return null;
    const { rows: findingRows } = await query(`SELECT * FROM security_findings WHERE scan_run_id = $1 ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, file_path`, [scanId]);
    return {
        ...mapScanRow(rows[0]),
        findings: findingRows.map((f) => ({
            id: f.id,
            filePath: f.file_path,
            lineStart: f.line_start,
            lineEnd: f.line_end,
            severity: f.severity,
            category: f.category,
            title: f.title,
            description: f.description,
            recommendation: f.recommendation,
            codeSnippet: f.code_snippet,
            confidence: f.confidence ? parseFloat(f.confidence) : null,
        })),
    };
}
export async function listScanFindings(userId, scanId, filters = {}) {
    const scan = await getSecurityScan(userId, scanId);
    if (!scan)
        return [];
    let findings = scan.findings;
    if (filters.severity)
        findings = findings.filter((f) => f.severity === filters.severity);
    if (filters.category)
        findings = findings.filter((f) => f.category === filters.category);
    return findings;
}
export async function getSecurityDashboardStats(userId) {
    const { rows } = await query(`SELECT
       (SELECT COUNT(*)::text FROM security_scan_runs WHERE user_id = $1) AS total_scans,
       (SELECT last_scan_at FROM github_code_config WHERE user_id = $1) AS last_scan_at,
       (SELECT COUNT(*)::text FROM security_findings sf
        JOIN security_scan_runs sr ON sr.id = sf.scan_run_id
        WHERE sr.user_id = $1 AND sf.severity = 'critical') AS critical_count,
       (SELECT COUNT(*)::text FROM security_findings sf
        JOIN security_scan_runs sr ON sr.id = sf.scan_run_id
        WHERE sr.user_id = $1 AND sf.severity = 'high') AS high_count`, [userId]);
    const r = rows[0];
    return {
        totalScans: parseInt(r?.total_scans || '0', 10),
        lastScanAt: r?.last_scan_at?.toISOString() || null,
        criticalCount: parseInt(r?.critical_count || '0', 10),
        highCount: parseInt(r?.high_count || '0', 10),
    };
}
