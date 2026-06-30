import https from 'https';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient } from '../lib/ai-client.js';

export type JiraDeploymentType = 'cloud' | 'server';
export type JiraSyncFilter = 'resolved' | 'closed' | 'both';

export interface JiraConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
  projectKey?: string;
  deploymentType: JiraDeploymentType;
  syncFilter: JiraSyncFilter;
  insecureSsl?: boolean;
}

function getApiBaseUrl(cfg: JiraConfig): string {
  const base = cfg.baseUrl.replace(/\/$/, '');
  return cfg.deploymentType === 'server' ? `${base}/rest/api/2` : `${base}/rest/api/3`;
}

function createJiraClient(cfg: JiraConfig): AxiosInstance {
  const auth = Buffer.from(`${cfg.username}:${cfg.apiToken}`).toString('base64');
  return axios.create({
    baseURL: getApiBaseUrl(cfg),
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
    ...(cfg.insecureSsl
      ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
      : {}),
  });
}

function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map(adfToText).join('\n');
  }
  return '';
}

function extractDescription(desc: unknown): string {
  if (!desc) return '';
  if (typeof desc === 'string') return desc;
  return adfToText(desc);
}

const JIRA_ENV_PLACEHOLDERS = [
  'your-company.internal',
  'your-jira-username',
  'your-jira-password',
  'your-atlassian-api-token',
  'your-password-or-pat',
];

function isPlaceholderJiraEnvValue(value: string): boolean {
  const lower = value.toLowerCase();
  return JIRA_ENV_PLACEHOLDERS.some((p) => lower.includes(p));
}

export function getJiraConfigFromEnv(): JiraConfig | null {
  const { baseUrl, username, apiToken, projectKey, deploymentType, insecureSsl } = config.jira;
  if (!baseUrl || !username || !apiToken) return null;
  if (
    isPlaceholderJiraEnvValue(baseUrl) ||
    isPlaceholderJiraEnvValue(username) ||
    isPlaceholderJiraEnvValue(apiToken)
  ) {
    return null;
  }
  return {
    baseUrl,
    username,
    apiToken,
    projectKey,
    deploymentType,
    syncFilter: parseSyncFilter(config.jira.syncFilter),
    insecureSsl,
  };
}

function parseSyncFilter(value: string | null | undefined): JiraSyncFilter {
  if (value === 'closed' || value === 'both') return value;
  return 'resolved';
}

async function getJiraConfigFromDb(userId: string): Promise<JiraConfig | null> {
  const { rows } = await query<{
    base_url: string;
    email: string;
    api_token_encrypted: string;
    project_key: string;
    deployment_type: JiraDeploymentType | null;
    sync_filter: string | null;
    insecure_ssl: boolean | null;
  }>(
    'SELECT base_url, email, api_token_encrypted, project_key, deployment_type, sync_filter, insecure_ssl FROM jira_config WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (!rows[0]) return null;
  return {
    baseUrl: rows[0].base_url,
    username: rows[0].email,
    apiToken: rows[0].api_token_encrypted,
    projectKey: rows[0].project_key,
    deploymentType: rows[0].deployment_type || 'server',
    syncFilter: parseSyncFilter(rows[0].sync_filter),
    insecureSsl: rows[0].insecure_ssl === true,
  };
}

export async function getJiraConfigForUser(userId: string): Promise<JiraConfig | null> {
  const db = await getJiraConfigFromDb(userId);
  if (db) return db;
  return getJiraConfigFromEnv();
}

export async function saveJiraConfig(
  userId: string,
  data: {
    baseUrl: string;
    username: string;
    apiToken: string;
    projectKey?: string;
    deploymentType?: JiraDeploymentType;
    syncFilter?: JiraSyncFilter;
    insecureSsl?: boolean;
  }
) {
  await query(
    `INSERT INTO jira_config (user_id, base_url, email, api_token_encrypted, project_key, deployment_type, sync_filter, insecure_ssl)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       email = EXCLUDED.email,
       api_token_encrypted = EXCLUDED.api_token_encrypted,
       project_key = EXCLUDED.project_key,
       deployment_type = EXCLUDED.deployment_type,
       sync_filter = EXCLUDED.sync_filter,
       insecure_ssl = EXCLUDED.insecure_ssl,
       updated_at = NOW()`,
    [
      userId,
      data.baseUrl,
      data.username,
      data.apiToken,
      data.projectKey || null,
      data.deploymentType || 'server',
      data.syncFilter || 'resolved',
      data.insecureSsl === true,
    ]
  );
}

export interface JiraConnectionTestResult {
  ok: boolean;
  authorization: 'success' | 'failed' | 'not_configured';
  httpStatus?: number;
  message: string;
  details: {
    baseUrl?: string;
    apiUrl?: string;
    deploymentType?: string;
    authMethod: string;
    jiraUsername?: string;
    displayName?: string;
    emailAddress?: string;
    serverVersion?: string;
    serverTitle?: string;
    projectKey?: string;
    projectName?: string;
    projectAccessible?: boolean;
    syncFilter?: string;
    syncFilterLabel?: string;
    matchingTicketCount?: number;
    insecureSsl?: boolean;
    testedAt: string;
  };
}

const SYNC_FILTER_LABELS: Record<JiraSyncFilter, string> = {
  resolved: 'Resolved (has resolution)',
  closed: 'Closed status',
  both: 'Resolved or Closed',
};

function authFailureMessage(status: number | undefined, detail: string): string {
  if (status === 401) {
    return `Authorization failed (HTTP 401): Invalid username or password. ${detail}`.trim();
  }
  if (status === 403) {
    return `Authorization denied (HTTP 403): Credentials accepted but access forbidden. ${detail}`.trim();
  }
  if (status === 404) {
    return `Jira API not found (HTTP 404): Check Base URL and port (e.g. :8443). ${detail}`.trim();
  }
  return detail;
}

export async function testJiraConnection(
  userId: string,
  overrides?: Partial<JiraConfig> & { apiToken?: string }
): Promise<JiraConnectionTestResult> {
  const testedAt = new Date().toISOString();
  const saved = await getJiraConfigForUser(userId);

  const cfg: JiraConfig | null = saved
    ? {
        ...saved,
        ...overrides,
        apiToken: overrides?.apiToken?.trim() ? overrides.apiToken : saved.apiToken,
        username: overrides?.username?.trim() ? overrides.username : saved.username,
      }
    : overrides?.baseUrl && overrides?.username && overrides?.apiToken
      ? {
          baseUrl: overrides.baseUrl,
          username: overrides.username,
          apiToken: overrides.apiToken,
          projectKey: overrides.projectKey,
          deploymentType: overrides.deploymentType || 'server',
          syncFilter: overrides.syncFilter || 'resolved',
          insecureSsl: overrides.insecureSsl === true,
        }
      : null;

  if (!cfg?.baseUrl || !cfg.username || !cfg.apiToken) {
    return {
      ok: false,
      authorization: 'not_configured',
      message: 'Jira is not configured. Enter Base URL, username, and password, then test again.',
      details: { authMethod: 'Basic', testedAt },
    };
  }

  const apiUrl = getApiBaseUrl(cfg);
  const client = createJiraClient(cfg);
  const baseDetails = {
    baseUrl: cfg.baseUrl,
    apiUrl,
    deploymentType: cfg.deploymentType,
    authMethod: 'Basic (username + password or PAT)',
    projectKey: cfg.projectKey || undefined,
    syncFilter: cfg.syncFilter,
    syncFilterLabel: SYNC_FILTER_LABELS[cfg.syncFilter],
    insecureSsl: cfg.insecureSsl === true,
    testedAt,
  };

  try {
    const myselfPath = cfg.deploymentType === 'server' ? '/myself' : '/myself';
    const { data: myself, status } = await client.get<{
      name?: string;
      displayName?: string;
      emailAddress?: string;
      key?: string;
    }>(myselfPath);

    const details: JiraConnectionTestResult['details'] = {
      ...baseDetails,
      jiraUsername: myself.name || myself.key,
      displayName: myself.displayName,
      emailAddress: myself.emailAddress,
    };

    if (cfg.deploymentType === 'server') {
      try {
        const { data: serverInfo } = await client.get<{
          version?: string;
          serverTitle?: string;
        }>('/serverInfo');
        details.serverVersion = serverInfo.version;
        details.serverTitle = serverInfo.serverTitle;
      } catch {
        // optional
      }
    }

    if (cfg.projectKey) {
      try {
        const { data: project } = await client.get<{ key?: string; name?: string }>(
          `/project/${cfg.projectKey}`
        );
        details.projectAccessible = true;
        details.projectName = project.name;
      } catch {
        details.projectAccessible = false;
      }
    }

    try {
      const jql = buildSyncIssuesJql(cfg.projectKey || '', cfg.deploymentType, cfg.syncFilter);
      const searchPath = cfg.deploymentType === 'server' ? '/search' : '/search/jql';
      const { data: searchResult } = await client.get<{ total?: number }>(searchPath, {
        params: { jql, startAt: 0, maxResults: 0 },
      });
      details.matchingTicketCount = searchResult.total ?? 0;
    } catch {
      // search may fail even when auth works — reported separately if needed
    }

    let message = `Authorization successful (HTTP ${status ?? 200}). Logged in as ${details.displayName || details.jiraUsername}.`;
    if (cfg.projectKey && details.projectAccessible === false) {
      message += ` Warning: project "${cfg.projectKey}" was not found or is not accessible.`;
    } else if (cfg.projectKey && details.projectName) {
      message += ` Project "${cfg.projectKey}" (${details.projectName}) is accessible.`;
    }
    if (details.matchingTicketCount !== undefined) {
      message += ` ${details.matchingTicketCount} ticket(s) match your sync filter.`;
    }

    return {
      ok: true,
      authorization: 'success',
      httpStatus: status ?? 200,
      message,
      details,
    };
  } catch (err) {
    const httpStatus = isAxiosError(err) ? err.response?.status : undefined;
    const detail = formatJiraApiError(err);
    let message = authFailureMessage(httpStatus, detail);

    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|UNABLE_TO_VERIFY/i.test(detail)) {
      if (/certificate|UNABLE_TO_VERIFY/i.test(detail)) {
        message = `Cannot connect securely to ${cfg.baseUrl}. Enable "Allow self-signed certificate" if using internal HTTPS (e.g. port 8443). (${detail})`;
      } else {
        message = `Cannot reach Jira at ${cfg.baseUrl}. Connect to VPN, verify the URL includes the correct port (e.g. :8443), then retry. (${detail})`;
      }
    }

    return {
      ok: false,
      authorization: 'failed',
      httpStatus,
      message,
      details: baseDetails,
    };
  }
}

function formatJiraApiError(err: unknown): string {
  if (!isAxiosError(err)) {
    return err instanceof Error ? err.message : 'Sync failed';
  }
  const status = err.response?.status;
  const data = err.response?.data;
  if (data && typeof data === 'object') {
    const messages = (data as { errorMessages?: string[] }).errorMessages;
    if (messages?.length) {
      return `Jira API error (${status}): ${messages.join('; ')}`;
    }
    const errors = (data as { errors?: Record<string, string> }).errors;
    if (errors && Object.keys(errors).length) {
      return `Jira API error (${status}): ${Object.values(errors).join('; ')}`;
    }
    const message = (data as { message?: string }).message;
    if (message) {
      return `Jira API error (${status}): ${message}`;
    }
  }
  return err.message;
}

function buildSyncIssuesJql(
  projectKey: string,
  deploymentType: JiraDeploymentType,
  syncFilter: JiraSyncFilter
): string {
  const orderBy =
    syncFilter === 'closed'
      ? 'updated DESC'
      : deploymentType === 'server'
        ? 'resolutiondate DESC'
        : 'updated DESC';

  let statusClause: string;
  switch (syncFilter) {
    case 'closed':
      statusClause = 'status = Closed';
      break;
    case 'both':
      statusClause = '(resolution IS NOT EMPTY OR status = Closed)';
      break;
    default:
      statusClause = 'resolution IS NOT EMPTY';
  }

  if (projectKey) {
    return `project = "${projectKey}" AND ${statusClause} ORDER BY ${orderBy}`;
  }
  return `${statusClause} ORDER BY ${orderBy}`;
}

async function fetchResolvedIssues(
  client: AxiosInstance,
  deploymentType: JiraDeploymentType,
  projectKey: string,
  syncFilter: JiraSyncFilter,
  startAt = 0
) {
  const jql = buildSyncIssuesJql(projectKey, deploymentType, syncFilter);

  const params = {
    jql,
    startAt,
    maxResults: 50,
    fields:
      'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
  };

  const searchPath = deploymentType === 'server' ? '/search' : '/search/jql';
  const { data } = await client.get(searchPath, { params });
  return data;
}

async function fetchAllIssues(
  client: AxiosInstance,
  deploymentType: JiraDeploymentType,
  projectKey: string,
  syncFilter: JiraSyncFilter
) {
  const issues: Record<string, unknown>[] = [];
  let startAt = 0;
  let total = 1;

  while (startAt < total) {
    const data = await fetchResolvedIssues(client, deploymentType, projectKey, syncFilter, startAt);
    const batch = (data.issues || []) as Record<string, unknown>[];
    issues.push(...batch);
    total = data.total as number;
    startAt += batch.length;
    if (batch.length === 0) break;
  }
  return issues;
}

function parseIssue(issue: Record<string, unknown>) {
  const fields = issue.fields as Record<string, unknown>;
  const key = issue.key as string;
  const id = issue.id as string;
  const title = (fields.summary as string) || '';
  const description = extractDescription(fields.description);
  const status = ((fields.status as Record<string, unknown>)?.name as string) || 'Unknown';
  const priority = ((fields.priority as Record<string, unknown>)?.name as string) || null;
  const labels = (fields.labels as string[]) || [];
  const assignee = ((fields.assignee as Record<string, unknown>)?.displayName as string) || null;
  const reporter = ((fields.reporter as Record<string, unknown>)?.displayName as string) || null;
  const issueType = ((fields.issuetype as Record<string, unknown>)?.name as string) || null;
  const resolution = ((fields.resolution as Record<string, unknown>)?.name as string) || null;
  const created = fields.created as string;
  const resolved = fields.resolutiondate as string;

  const comments: { id: string; author: string; body: string; created: string }[] = [];
  const commentField = fields.comment as Record<string, unknown> | undefined;
  if (commentField?.comments) {
    for (const c of commentField.comments as Record<string, unknown>[]) {
      comments.push({
        id: c.id as string,
        author: ((c.author as Record<string, unknown>)?.displayName as string) || 'Unknown',
        body: extractDescription(c.body),
        created: c.created as string,
      });
    }
  }

  const resolutionNotes = comments
    .filter((c) => /fix|resolv|root cause|solution|workaround/i.test(c.body))
    .map((c) => c.body)
    .join('\n---\n');

  const finalFix = comments.length > 0 ? comments[comments.length - 1].body : resolutionNotes;

  let resolutionTimeHours: number | null = null;
  if (created && resolved) {
    resolutionTimeHours = (new Date(resolved).getTime() - new Date(created).getTime()) / 3600000;
  }

  return {
    jiraKey: key,
    jiraId: id,
    title,
    description,
    status,
    priority,
    labels,
    assignee,
    reporter,
    issueType,
    resolution,
    resolutionNotes: resolutionNotes || null,
    finalFix: finalFix || null,
    createdAtJira: created ? new Date(created) : null,
    resolvedAtJira: resolved ? new Date(resolved) : null,
    resolutionTimeHours,
    comments,
    rawPayload: issue,
  };
}

export async function syncJiraTickets(userId: string): Promise<{
  fetched: number;
  created: number;
  updated: number;
  embeddingsIndexed: number;
}> {
  const cfg = await getJiraConfigForUser(userId);
  if (!cfg) throw new Error('Jira not configured. Set credentials in Admin Sync Settings or .env');

  const client = createJiraClient(cfg);
  const projectKey = cfg.projectKey || config.jira.projectKey || '';

  const log = await query<{ id: string }>(
    `INSERT INTO sync_logs (status) VALUES ('running') RETURNING id`
  );
  const logId = log.rows[0].id;

  let created = 0;
  let updated = 0;
  let embeddingsIndexed = 0;

  try {
    const issues = await fetchAllIssues(client, cfg.deploymentType, projectKey, cfg.syncFilter);

    for (const issue of issues) {
      const parsed = parseIssue(issue);

      const existing = await query<{ id: string }>(
        'SELECT id FROM jira_tickets WHERE jira_key = $1',
        [parsed.jiraKey]
      );

      let ticketId: string;

      if (existing.rows[0]) {
        ticketId = existing.rows[0].id;
        await query(
          `UPDATE jira_tickets SET
            title=$2, description=$3, status=$4, priority=$5, labels=$6,
            assignee=$7, reporter=$8, issue_type=$9, resolution=$10,
            resolution_notes=$11, final_fix=$12, resolution_time_hours=$13,
            created_at_jira=$14, resolved_at_jira=$15, raw_payload=$16,
            embedding_synced=false, updated_at=NOW(), synced_at=NOW()
           WHERE id=$1`,
          [
            ticketId,
            parsed.title,
            parsed.description,
            parsed.status,
            parsed.priority,
            parsed.labels,
            parsed.assignee,
            parsed.reporter,
            parsed.issueType,
            parsed.resolution,
            parsed.resolutionNotes,
            parsed.finalFix,
            parsed.resolutionTimeHours,
            parsed.createdAtJira,
            parsed.resolvedAtJira,
            JSON.stringify(parsed.rawPayload),
          ]
        );
        updated++;
      } else {
        const ins = await query<{ id: string }>(
          `INSERT INTO jira_tickets (
            jira_key, jira_id, title, description, status, priority, labels,
            assignee, reporter, issue_type, resolution, resolution_notes, final_fix,
            resolution_time_hours, created_at_jira, resolved_at_jira, raw_payload
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          RETURNING id`,
          [
            parsed.jiraKey,
            parsed.jiraId,
            parsed.title,
            parsed.description,
            parsed.status,
            parsed.priority,
            parsed.labels,
            parsed.assignee,
            parsed.reporter,
            parsed.issueType,
            parsed.resolution,
            parsed.resolutionNotes,
            parsed.finalFix,
            parsed.resolutionTimeHours,
            parsed.createdAtJira,
            parsed.resolvedAtJira,
            JSON.stringify(parsed.rawPayload),
          ]
        );
        ticketId = ins.rows[0].id;
        created++;
      }

      await query('DELETE FROM ticket_comments WHERE ticket_id = $1', [ticketId]);
      for (const c of parsed.comments) {
        await query(
          `INSERT INTO ticket_comments (ticket_id, jira_comment_id, author, body, created_at_jira)
           VALUES ($1, $2, $3, $4, $5)`,
          [ticketId, c.id, c.author, c.body, c.created ? new Date(c.created) : null]
        );
      }

      try {
        const commentBodies = parsed.comments.map((c) => c.body);
        const embedResult = await aiClient.embedTicket({
          ticketId,
          jiraKey: parsed.jiraKey,
          title: parsed.title,
          description: parsed.description,
          comments: commentBodies,
          resolution: [parsed.resolutionNotes, parsed.finalFix].filter(Boolean).join('\n'),
          labels: parsed.labels,
        });

        if (embedResult.success) {
          await query(
            `INSERT INTO ticket_embeddings (ticket_id, chroma_id, embedding_model, content_hash)
             VALUES ($1, $2, 'text-embedding-3-small', $3)
             ON CONFLICT (ticket_id) DO UPDATE SET chroma_id=$2, updated_at=NOW()`,
            [ticketId, embedResult.chromaId, `${parsed.jiraKey}-${Date.now()}`]
          );
          await query('UPDATE jira_tickets SET embedding_synced = true WHERE id = $1', [ticketId]);
          embeddingsIndexed++;
        }
      } catch (embedErr) {
        console.warn(`Embedding failed for ${parsed.jiraKey}:`, embedErr);
      }
    }

    await query(
      `UPDATE sync_logs SET completed_at=NOW(), tickets_fetched=$2, tickets_created=$3,
       tickets_updated=$4, embeddings_indexed=$5, status='completed' WHERE id=$1`,
      [logId, issues.length, created, updated, embeddingsIndexed]
    );

    await query(
      `UPDATE jira_config SET last_sync_at=NOW(), sync_status='completed', updated_at=NOW()
       WHERE user_id=$1`,
      [userId]
    ).catch(() => {});

    return { fetched: issues.length, created, updated, embeddingsIndexed };
  } catch (err) {
    let msg = formatJiraApiError(err);
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) {
      msg = `Cannot reach Jira at ${cfg.baseUrl}. Connect to VPN if this is an internal Jira instance, verify the Base URL, and retry. (${msg})`;
    }
    await query(`UPDATE sync_logs SET status='failed', error_message=$2, completed_at=NOW() WHERE id=$1`, [
      logId,
      msg,
    ]);
    throw new Error(msg);
  }
}

export async function fetchTicketFromJira(userId: string, jiraKey: string) {
  const cfg = await getJiraConfigForUser(userId);
  if (!cfg) throw new Error('Jira not configured');

  const client = createJiraClient(cfg);
  const { data } = await client.get(`/issue/${jiraKey}`, {
    params: {
      fields:
        'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
    },
  });
  return parseIssue(data as Record<string, unknown>);
}
