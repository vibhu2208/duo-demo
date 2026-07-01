import axios, { isAxiosError } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient } from '../lib/ai-client.js';
const GITHUB_API = 'https://api.github.com';
const MAX_FILE_SIZE = 50 * 1024;
const MAX_FILES_PER_SCAN = 25;
const PRIORITY_SEGMENTS = ['src/', 'backend/', 'frontend/', 'routes/', 'middleware/', 'auth/', 'config/', 'services/', 'api/'];
const SCAN_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.sql',
]);
const SCAN_FILENAMES = new Set(['dockerfile', 'docker-compose.yml', '.env.example', 'package.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', 'vendor']);
const GITHUB_ENV_PLACEHOLDERS = ['ghp_your-token-here', 'your-token-here', 'github_pat_'];
function isPlaceholderToken(value) {
    const lower = value.toLowerCase();
    return GITHUB_ENV_PLACEHOLDERS.some((p) => lower.includes(p));
}
export function getGitHubConfigFromEnv() {
    const { token, defaultOwner } = config.github;
    if (!token || isPlaceholderToken(token))
        return null;
    return { token, defaultOwner: defaultOwner || undefined };
}
async function getGitHubConfigFromDb(userId) {
    const { rows } = await query('SELECT token_encrypted, default_owner FROM github_config WHERE user_id = $1 LIMIT 1', [userId]);
    if (!rows[0])
        return null;
    return {
        token: rows[0].token_encrypted,
        defaultOwner: rows[0].default_owner || undefined,
    };
}
export async function getGitHubConfigForUser(userId) {
    const db = await getGitHubConfigFromDb(userId);
    if (db)
        return db;
    return getGitHubConfigFromEnv();
}
export async function saveGitHubConfig(userId, data) {
    await query(`INSERT INTO github_config (user_id, token_encrypted, default_owner)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       token_encrypted = EXCLUDED.token_encrypted,
       default_owner = EXCLUDED.default_owner,
       updated_at = NOW()`, [userId, data.token, data.defaultOwner || null]);
}
export function createGitHubClient(token) {
    return axios.create({
        baseURL: GITHUB_API,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 60000,
    });
}
export async function testGitHubConnection(userId, overrides) {
    const cfg = overrides?.token
        ? { token: overrides.token, defaultOwner: overrides.defaultOwner }
        : await getGitHubConfigForUser(userId);
    const testedAt = new Date().toISOString();
    if (!cfg?.token) {
        return {
            ok: false,
            authorization: 'not_configured',
            message: 'GitHub is not configured. Add a Personal Access Token.',
            details: { testedAt },
        };
    }
    try {
        const client = createGitHubClient(cfg.token);
        const { data: user } = await client.get('/user');
        let repoCount;
        try {
            const repos = await listAccessibleRepos(cfg.token, cfg.defaultOwner);
            repoCount = repos.length;
        }
        catch {
            /* optional */
        }
        return {
            ok: true,
            authorization: 'success',
            message: `Connected as ${user.login}${user.name ? ` (${user.name})` : ''}`,
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
        return {
            ok: false,
            authorization: 'failed',
            httpStatus: status,
            message: status === 401 ? `Authorization failed (HTTP 401): Invalid token.` : `Connection failed: ${detail}`,
            details: { testedAt },
        };
    }
}
export async function listAccessibleRepos(token, owner) {
    const client = createGitHubClient(token);
    const repos = [];
    if (owner) {
        let page = 1;
        while (page <= 5) {
            const { data } = await client.get(`/orgs/${owner}/repos`, { params: { per_page: 100, page, sort: 'updated' } });
            if (!data.length)
                break;
            for (const r of data) {
                repos.push({
                    fullName: r.full_name,
                    owner: r.owner.login,
                    name: r.name,
                    defaultBranch: r.default_branch || 'main',
                    private: r.private,
                    description: r.description,
                });
            }
            if (data.length < 100)
                break;
            page++;
        }
        if (repos.length > 0)
            return repos;
    }
    let page = 1;
    while (page <= 5) {
        const { data } = await client.get('/user/repos', { params: { per_page: 100, page, sort: 'updated', affiliation: 'owner,collaborator,organization_member' } });
        if (!data.length)
            break;
        for (const r of data) {
            repos.push({
                fullName: r.full_name,
                owner: r.owner.login,
                name: r.name,
                defaultBranch: r.default_branch || 'main',
                private: r.private,
                description: r.description,
            });
        }
        if (data.length < 100)
            break;
        page++;
    }
    return repos;
}
function shouldIncludeFile(path, size) {
    if (size !== undefined && size > MAX_FILE_SIZE)
        return false;
    const lower = path.toLowerCase();
    const parts = lower.split('/');
    if (parts.some((p) => SKIP_DIRS.has(p)))
        return false;
    const basename = parts[parts.length - 1];
    if (SCAN_FILENAMES.has(basename))
        return basename === 'package.json';
    if (basename === 'dockerfile')
        return true;
    const dot = lower.lastIndexOf('.');
    if (dot === -1)
        return false;
    return SCAN_EXTENSIONS.has(lower.slice(dot));
}
function priorityScore(path) {
    const lower = path.toLowerCase();
    for (let i = 0; i < PRIORITY_SEGMENTS.length; i++) {
        if (lower.includes(PRIORITY_SEGMENTS[i]))
            return PRIORITY_SEGMENTS.length - i;
    }
    return 0;
}
export function selectFilesForScan(entries) {
    const candidates = entries
        .filter((e) => e.type === 'blob' && shouldIncludeFile(e.path, e.size))
        .sort((a, b) => priorityScore(b.path) - priorityScore(a.path));
    const selected = [];
    const hasPackageJson = candidates.some((c) => c.path.toLowerCase() === 'package.json');
    for (const c of candidates) {
        if (c.path.toLowerCase() === 'package.json')
            continue;
        if (selected.length >= MAX_FILES_PER_SCAN)
            break;
        selected.push(c.path);
    }
    if (hasPackageJson && selected.length < MAX_FILES_PER_SCAN) {
        selected.unshift('package.json');
    }
    return selected.slice(0, MAX_FILES_PER_SCAN);
}
function detectLanguage(path) {
    const lower = path.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx'))
        return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx'))
        return 'javascript';
    if (lower.endsWith('.py'))
        return 'python';
    if (lower.endsWith('.go'))
        return 'go';
    if (lower.endsWith('.java'))
        return 'java';
    if (lower.endsWith('.sql'))
        return 'sql';
    if (lower === 'dockerfile')
        return 'dockerfile';
    if (lower.endsWith('docker-compose.yml'))
        return 'yaml';
    if (lower.endsWith('.env.example'))
        return 'env';
    if (lower.endsWith('package.json'))
        return 'json';
    return 'text';
}
export async function fetchRepoTree(client, owner, repo, branch) {
    const { data: refData } = await client.get(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const commitSha = refData.object.sha;
    const { data: treeData } = await client.get(`/repos/${owner}/${repo}/git/trees/${commitSha}`, { params: { recursive: '1' } });
    return { sha: commitSha, entries: treeData.tree };
}
export async function fetchFileContents(client, owner, repo, path, branch) {
    const { data } = await client.get(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { params: { ref: branch } });
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
    const cfg = await getGitHubConfigForUser(userId);
    if (!cfg)
        throw new Error('GitHub is not configured');
    const branch = params.branch || 'main';
    const repoFullName = `${params.owner}/${params.repo}`;
    const { rows: scanRows } = await query(`INSERT INTO security_scan_runs (user_id, repo_full_name, branch, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`, [userId, repoFullName, branch]);
    const scanId = scanRows[0].id;
    await query(`UPDATE github_config SET scan_status = 'running', updated_at = NOW() WHERE user_id = $1`, [userId]);
    try {
        const client = createGitHubClient(cfg.token);
        const { sha, entries } = await fetchRepoTree(client, params.owner, params.repo, branch);
        const paths = selectFilesForScan(entries);
        const files = [];
        for (const path of paths) {
            try {
                const content = await fetchFileContents(client, params.owner, params.repo, path, branch);
                files.push({ path, language: detectLanguage(path), content });
            }
            catch (err) {
                console.warn(`[github-scan] skip ${path}:`, err instanceof Error ? err.message : err);
            }
        }
        let reviewResult = { findings: [], summary: '' };
        if (files.length > 0) {
            reviewResult = await aiClient.reviewCode({
                files,
                repo: repoFullName,
                branch,
            });
        }
        else {
            reviewResult.summary = 'No scannable source files found in this repository branch.';
        }
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
       RETURNING *`, [scanId, sha, files.length, reviewResult.findings.length, JSON.stringify(severitySummary), reviewResult.summary]);
        await query(`UPDATE github_config SET scan_status = 'idle', last_scan_at = NOW(), updated_at = NOW() WHERE user_id = $1`, [userId]);
        return mapScanRow(updated[0]);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        await query(`UPDATE security_scan_runs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`, [scanId, message]);
        await query(`UPDATE github_config SET scan_status = 'idle', updated_at = NOW() WHERE user_id = $1`, [userId]);
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
    const { rows: findingRows } = await query('SELECT * FROM security_findings WHERE scan_run_id = $1 ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 ELSE 5 END, file_path', [scanId]);
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
    if (filters.severity) {
        findings = findings.filter((f) => f.severity === filters.severity);
    }
    if (filters.category) {
        findings = findings.filter((f) => f.category === filters.category);
    }
    return findings;
}
export async function getSecurityDashboardStats(userId) {
    const { rows } = await query(`SELECT
       (SELECT COUNT(*)::text FROM security_scan_runs WHERE user_id = $1) AS total_scans,
       (SELECT last_scan_at FROM github_config WHERE user_id = $1) AS last_scan_at,
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
