import https from 'https';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient, type CodeReviewFinding, type CodeReviewResult } from '../lib/ai-client.js';
import {
  MAX_FILE_SIZE,
  TreeEntry,
  detectLanguage,
  selectFilesForScan,
} from './code-scan-utils.js';

export interface GitLabCodeConfig {
  baseUrl: string;
  token: string;
  defaultGroup?: string;
  insecureSsl?: boolean;
}

const GITLAB_TOKEN_PLACEHOLDERS = ['glpat-your-token-here', 'your-token-here', 'glpat-xxx'];
const GITLAB_GROUP_PLACEHOLDERS = ['optional-group', 'your-group', 'capgemini-group'];

function isPlaceholderToken(value: string): boolean {
  const lower = value.toLowerCase();
  return GITLAB_TOKEN_PLACEHOLDERS.some((p) => lower.includes(p));
}

function normalizeGroup(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (GITLAB_GROUP_PLACEHOLDERS.some((p) => lower === p || lower.includes(p))) return undefined;
  return trimmed;
}

export function getGitLabCodeConfigFromEnv(): GitLabCodeConfig | null {
  const { baseUrl, token, defaultGroup, insecureSsl } = config.gitlab;
  if (!baseUrl || !token || isPlaceholderToken(token)) return null;
  return {
    baseUrl,
    token,
    defaultGroup: normalizeGroup(defaultGroup),
    insecureSsl,
  };
}

async function getGitLabCodeConfigFromDb(userId: string): Promise<GitLabCodeConfig | null> {
  const { rows } = await query<{
    base_url: string;
    token_encrypted: string;
    default_group: string | null;
    insecure_ssl: boolean | null;
  }>(
    'SELECT base_url, token_encrypted, default_group, insecure_ssl FROM gitlab_code_config WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (!rows[0]) return null;
  return {
    baseUrl: rows[0].base_url,
    token: rows[0].token_encrypted,
    defaultGroup: normalizeGroup(rows[0].default_group || undefined),
    insecureSsl: rows[0].insecure_ssl === true,
  };
}

export async function getGitLabCodeConfigForUser(userId: string): Promise<GitLabCodeConfig | null> {
  const db = await getGitLabCodeConfigFromDb(userId);
  if (db) return db;
  return getGitLabCodeConfigFromEnv();
}

export async function saveGitLabCodeConfig(
  userId: string,
  data: {
    baseUrl: string;
    token: string;
    defaultGroup?: string;
    insecureSsl?: boolean;
  }
) {
  await query(
    `INSERT INTO gitlab_code_config (user_id, base_url, token_encrypted, default_group, insecure_ssl)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       token_encrypted = EXCLUDED.token_encrypted,
       default_group = EXCLUDED.default_group,
       insecure_ssl = EXCLUDED.insecure_ssl,
       updated_at = NOW()`,
    [
      userId,
      data.baseUrl.replace(/\/$/, ''),
      data.token,
      data.defaultGroup || null,
      data.insecureSsl === true,
    ]
  );
}

export function encodeProjectPath(projectPath: string): string {
  return encodeURIComponent(projectPath);
}

export function createGitLabClient(cfg: GitLabCodeConfig): AxiosInstance {
  return axios.create({
    baseURL: `${cfg.baseUrl.replace(/\/$/, '')}/api/v4`,
    headers: {
      'PRIVATE-TOKEN': cfg.token,
      Authorization: `Bearer ${cfg.token}`,
    },
    timeout: 60000,
    ...(cfg.insecureSsl
      ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
      : {}),
  });
}

export interface GitLabConnectionTestResult {
  ok: boolean;
  authorization: 'success' | 'failed' | 'not_configured';
  httpStatus?: number;
  message: string;
  details: {
    baseUrl?: string;
    username?: string;
    name?: string;
    defaultGroup?: string;
    projectCount?: number;
    insecureSsl?: boolean;
    testedAt: string;
  };
}

export async function testGitLabCodeConnection(
  userId: string,
  overrides?: Partial<GitLabCodeConfig> & { token?: string }
): Promise<GitLabConnectionTestResult> {
  const saved = await getGitLabCodeConfigForUser(userId);
  const cfg: GitLabCodeConfig | null = saved
    ? {
        ...saved,
        ...overrides,
        baseUrl: overrides?.baseUrl?.replace(/\/$/, '') || saved.baseUrl,
        token: overrides?.token?.trim() ? overrides.token : saved.token,
      }
    : overrides?.baseUrl && overrides?.token
      ? {
          baseUrl: overrides.baseUrl.replace(/\/$/, ''),
          token: overrides.token,
          defaultGroup: overrides.defaultGroup,
          insecureSsl: overrides.insecureSsl === true,
        }
      : null;

  const testedAt = new Date().toISOString();

  if (!cfg?.baseUrl || !cfg.token) {
    return {
      ok: false,
      authorization: 'not_configured',
      message: 'GitLab is not configured. Set GITLAB_URL and a Personal Access Token (api scope).',
      details: { testedAt },
    };
  }

  try {
    const client = createGitLabClient(cfg);
    const { data: user, status } = await client.get<{ username: string; name: string }>('/user');

    let projectCount: number | undefined;
    try {
      const projects = await listAccessibleProjects(cfg);
      projectCount = projects.length;
    } catch {
      /* optional */
    }

    return {
      ok: true,
      authorization: 'success',
      httpStatus: status,
      message: `Connected to GitLab as ${user.name || user.username} (${cfg.baseUrl})`,
      details: {
        baseUrl: cfg.baseUrl,
        username: user.username,
        name: user.name,
        defaultGroup: cfg.defaultGroup,
        projectCount,
        insecureSsl: cfg.insecureSsl,
        testedAt,
      },
    };
  } catch (err) {
    const status = isAxiosError(err) ? err.response?.status : undefined;
    const detail = isAxiosError(err)
      ? String((err.response?.data as { message?: string })?.message || err.message)
      : err instanceof Error
        ? err.message
        : 'Unknown error';

    let message =
      status === 401
        ? `Authorization failed (HTTP 401): Invalid GitLab token. Use a PAT with api scope.`
        : `Connection failed: ${detail}`;

    if (/certificate|UNABLE_TO_VERIFY/i.test(detail)) {
      message = `TLS error connecting to ${cfg.baseUrl}. Enable "Allow self-signed certificate" for on-prem GitLab.`;
    } else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(detail)) {
      message = `Cannot reach GitLab at ${cfg.baseUrl}. Connect to VPN and verify the URL.`;
    }

    return {
      ok: false,
      authorization: 'failed',
      httpStatus: status,
      message,
      details: { baseUrl: cfg.baseUrl, testedAt },
    };
  }
}

export interface GitLabProject {
  fullName: string;
  projectPath: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  webUrl: string | null;
}

export async function listAccessibleProjects(cfg: GitLabCodeConfig): Promise<GitLabProject[]> {
  const client = createGitLabClient(cfg);
  const projects: GitLabProject[] = [];
  const seen = new Set<string>();

  const addProjects = (
    data: {
      path_with_namespace: string;
      name: string;
      default_branch?: string;
      visibility: string;
      description: string | null;
      web_url: string;
    }[]
  ) => {
    for (const p of data) {
      if (seen.has(p.path_with_namespace)) continue;
      seen.add(p.path_with_namespace);
      projects.push({
        fullName: p.path_with_namespace,
        projectPath: p.path_with_namespace,
        name: p.name,
        defaultBranch: p.default_branch || 'main',
        private: p.visibility === 'private' || p.visibility === 'internal',
        description: p.description,
        webUrl: p.web_url,
      });
    }
  };

  const fetchPaged = async (path: string, params: Record<string, string | number | boolean>) => {
    let page = 1;
    while (page <= 5) {
      const { data } = await client.get<
        {
          path_with_namespace: string;
          name: string;
          default_branch?: string;
          visibility: string;
          description: string | null;
          web_url: string;
        }[]
      >(path, { params: { ...params, per_page: 100, page } });
      if (!data.length) break;
      addProjects(data);
      if (data.length < 100) break;
      page++;
    }
  };

  const normalizedGroup = normalizeGroup(cfg.defaultGroup);

  if (normalizedGroup) {
    const groupId = encodeProjectPath(normalizedGroup);
    try {
      await fetchPaged(`/groups/${groupId}/projects`, { include_subgroups: true, order_by: 'last_activity_at' });
    } catch (err) {
      if (!isAxiosError(err) || err.response?.status !== 404) throw err;
    }
  }

  await fetchPaged('/projects', {
    membership: true,
    order_by: 'last_activity_at',
    simple: true,
  });

  return projects;
}

export async function fetchRepoTree(
  client: AxiosInstance,
  projectPath: string,
  branch: string
): Promise<{ sha: string; entries: TreeEntry[] }> {
  const projectId = encodeProjectPath(projectPath);
  const entries: TreeEntry[] = [];
  let page = 1;

  while (page <= 15) {
    const { data } = await client.get<{ path: string; type: string }[]>(
      `/projects/${projectId}/repository/tree`,
      { params: { ref: branch, recursive: true, per_page: 100, page } }
    );
    if (!data.length) break;
    for (const item of data) {
      entries.push({
        path: item.path,
        type: item.type === 'tree' ? 'tree' : 'blob',
      });
    }
    if (data.length < 100) break;
    page++;
  }

  const { data: commits } = await client.get<{ id: string }[]>(
    `/projects/${projectId}/repository/commits`,
    { params: { ref_name: branch, per_page: 1 } }
  );

  return { sha: commits[0]?.id || '', entries };
}

export async function listScannableFiles(
  cfg: GitLabCodeConfig,
  projectPath: string,
  branch: string
): Promise<{ sha: string; files: string[] }> {
  const client = createGitLabClient(cfg);
  const { sha, entries } = await fetchRepoTree(client, projectPath, branch);
  return { sha, files: selectFilesForScan(entries) };
}

export async function fetchFileContents(
  client: AxiosInstance,
  projectPath: string,
  path: string,
  branch: string
): Promise<string> {
  const projectId = encodeProjectPath(projectPath);
  const filePath = encodeURIComponent(path);

  const { data, headers } = await client.get<string>(
    `/projects/${projectId}/repository/files/${filePath}/raw`,
    {
      params: { ref: branch },
      responseType: 'text',
      transformResponse: [(r) => r],
    }
  );

  const content = typeof data === 'string' ? data : String(data);
  const contentLength = parseInt(String(headers['content-length'] || content.length), 10);
  if (contentLength > MAX_FILE_SIZE) {
    throw new Error(`File ${path} exceeds size limit`);
  }
  return content;
}

function buildSeveritySummary(findings: CodeReviewFinding[]): Record<string, number> {
  const summary: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    const sev = f.severity in summary ? f.severity : 'info';
    summary[sev]++;
  }
  return summary;
}

export interface SecurityScanRun {
  id: string;
  repoFullName: string;
  branch: string;
  commitSha: string | null;
  status: string;
  filesScanned: number;
  findingsCount: number;
  severitySummary: Record<string, number>;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface SecurityFindingRow {
  id: string;
  filePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  recommendation: string | null;
  codeSnippet: string | null;
  confidence: number | null;
}

function mapScanRow(row: {
  id: string;
  repo_full_name: string;
  branch: string;
  commit_sha: string | null;
  status: string;
  files_scanned: number;
  findings_count: number;
  severity_summary: Record<string, number> | null;
  summary: string | null;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
}): SecurityScanRun {
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

export async function runSecurityScan(
  userId: string,
  params: { projectPath: string; branch?: string; filePath: string }
): Promise<SecurityScanRun> {
  const cfg = await getGitLabCodeConfigForUser(userId);
  if (!cfg) throw new Error('GitLab is not configured');

  const branch = params.branch || 'main';
  const repoFullName = params.projectPath;
  const filePath = params.filePath.trim();
  if (!filePath) throw new Error('filePath is required — select one file to scan');

  const { rows: scanRows } = await query<{ id: string }>(
    `INSERT INTO security_scan_runs (user_id, repo_full_name, branch, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id`,
    [userId, repoFullName, branch]
  );
  const scanId = scanRows[0].id;

  await query(
    `UPDATE gitlab_code_config SET scan_status = 'running', updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );

  try {
    const client = createGitLabClient(cfg);
    const { sha } = await fetchRepoTree(client, params.projectPath, branch);
    const content = await fetchFileContents(client, params.projectPath, filePath, branch);

    const files = [{ path: filePath, language: detectLanguage(filePath), content }];

    const reviewResult: CodeReviewResult = await aiClient.reviewCode({
      files,
      repo: repoFullName,
      branch,
      mode: 'single-file-sections',
    });

    const severitySummary = buildSeveritySummary(reviewResult.findings);

    for (const f of reviewResult.findings) {
      await query(
        `INSERT INTO security_findings
         (scan_run_id, file_path, line_start, line_end, severity, category, title, description, recommendation, code_snippet, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
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
        ]
      );
    }

    const { rows: updated } = await query<{
      id: string;
      repo_full_name: string;
      branch: string;
      commit_sha: string | null;
      status: string;
      files_scanned: number;
      findings_count: number;
      severity_summary: Record<string, number> | null;
      summary: string | null;
      error_message: string | null;
      started_at: Date;
      completed_at: Date | null;
    }>(
      `UPDATE security_scan_runs SET
         commit_sha = $2,
         status = 'completed',
         files_scanned = $3,
         findings_count = $4,
         severity_summary = $5,
         summary = $6,
         completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [scanId, sha, 1, reviewResult.findings.length, JSON.stringify(severitySummary), reviewResult.summary]
    );

    await query(
      `UPDATE gitlab_code_config SET scan_status = 'idle', last_scan_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    return mapScanRow(updated[0]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed';
    await query(
      `UPDATE security_scan_runs SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1`,
      [scanId, message]
    );
    await query(
      `UPDATE gitlab_code_config SET scan_status = 'idle', updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
    throw err;
  }
}

export async function listSecurityScans(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ scans: SecurityScanRun[]; total: number }> {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const { rows: countRows } = await query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM security_scan_runs WHERE user_id = $1',
    [userId]
  );

  const { rows } = await query<{
    id: string;
    repo_full_name: string;
    branch: string;
    commit_sha: string | null;
    status: string;
    files_scanned: number;
    findings_count: number;
    severity_summary: Record<string, number> | null;
    summary: string | null;
    error_message: string | null;
    started_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT * FROM security_scan_runs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return {
    scans: rows.map(mapScanRow),
    total: parseInt(countRows[0]?.count || '0', 10),
  };
}

export async function getSecurityScan(
  userId: string,
  scanId: string
): Promise<(SecurityScanRun & { findings: SecurityFindingRow[] }) | null> {
  const { rows } = await query<{
    id: string;
    repo_full_name: string;
    branch: string;
    commit_sha: string | null;
    status: string;
    files_scanned: number;
    findings_count: number;
    severity_summary: Record<string, number> | null;
    summary: string | null;
    error_message: string | null;
    started_at: Date;
    completed_at: Date | null;
  }>(
    'SELECT * FROM security_scan_runs WHERE id = $1 AND user_id = $2 LIMIT 1',
    [scanId, userId]
  );

  if (!rows[0]) return null;

  const { rows: findingRows } = await query<{
    id: string;
    file_path: string;
    line_start: number | null;
    line_end: number | null;
    severity: string;
    category: string;
    title: string;
    description: string | null;
    recommendation: string | null;
    code_snippet: string | null;
    confidence: string | null;
  }>(
    `SELECT * FROM security_findings WHERE scan_run_id = $1 ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, file_path`,
    [scanId]
  );

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

export async function listScanFindings(
  userId: string,
  scanId: string,
  filters: { severity?: string; category?: string } = {}
): Promise<SecurityFindingRow[]> {
  const scan = await getSecurityScan(userId, scanId);
  if (!scan) return [];

  let findings = scan.findings;
  if (filters.severity) findings = findings.filter((f) => f.severity === filters.severity);
  if (filters.category) findings = findings.filter((f) => f.category === filters.category);
  return findings;
}

export async function getSecurityDashboardStats(userId: string) {
  const { rows } = await query<{
    total_scans: string;
    last_scan_at: Date | null;
    critical_count: string;
    high_count: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM security_scan_runs WHERE user_id = $1) AS total_scans,
       (SELECT last_scan_at FROM gitlab_code_config WHERE user_id = $1) AS last_scan_at,
       (SELECT COUNT(*)::text FROM security_findings sf
        JOIN security_scan_runs sr ON sr.id = sf.scan_run_id
        WHERE sr.user_id = $1 AND sf.severity = 'critical') AS critical_count,
       (SELECT COUNT(*)::text FROM security_findings sf
        JOIN security_scan_runs sr ON sr.id = sf.scan_run_id
        WHERE sr.user_id = $1 AND sf.severity = 'high') AS high_count`,
    [userId]
  );

  const r = rows[0];
  return {
    totalScans: parseInt(r?.total_scans || '0', 10),
    lastScanAt: r?.last_scan_at?.toISOString() || null,
    criticalCount: parseInt(r?.critical_count || '0', 10),
    highCount: parseInt(r?.high_count || '0', 10),
  };
}
