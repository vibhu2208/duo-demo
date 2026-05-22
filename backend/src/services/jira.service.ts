import axios, { AxiosInstance } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient } from '../lib/ai-client.js';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string;
}

function createJiraClient(cfg: JiraConfig): AxiosInstance {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64');
  return axios.create({
    baseURL: `${cfg.baseUrl.replace(/\/$/, '')}/rest/api/3`,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
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

export function getJiraConfigFromEnv(): JiraConfig | null {
  if (!config.jira.baseUrl || !config.jira.email || !config.jira.apiToken) return null;
  return {
    baseUrl: config.jira.baseUrl,
    email: config.jira.email,
    apiToken: config.jira.apiToken,
    projectKey: config.jira.projectKey,
  };
}

export async function getJiraConfigForUser(userId: string): Promise<JiraConfig | null> {
  const env = getJiraConfigFromEnv();
  if (env) return env;

  const { rows } = await query<{ base_url: string; email: string; api_token_encrypted: string; project_key: string }>(
    'SELECT base_url, email, api_token_encrypted, project_key FROM jira_config WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  if (!rows[0]) return null;
  return {
    baseUrl: rows[0].base_url,
    email: rows[0].email,
    apiToken: rows[0].api_token_encrypted,
    projectKey: rows[0].project_key,
  };
}

export async function saveJiraConfig(
  userId: string,
  data: { baseUrl: string; email: string; apiToken: string; projectKey?: string }
) {
  await query(
    `INSERT INTO jira_config (user_id, base_url, email, api_token_encrypted, project_key)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       email = EXCLUDED.email,
       api_token_encrypted = EXCLUDED.api_token_encrypted,
       project_key = EXCLUDED.project_key,
       updated_at = NOW()`,
    [userId, data.baseUrl, data.email, data.apiToken, data.projectKey || null]
  );
}

async function fetchResolvedIssues(client: AxiosInstance, projectKey: string, startAt = 0) {
  const jql = projectKey
    ? `project = ${projectKey} AND resolution IS NOT EMPTY ORDER BY resolved DESC`
    : 'resolution IS NOT EMPTY ORDER BY resolved DESC';

  const { data } = await client.get('/search/jql', {
    params: {
      jql,
      startAt,
      maxResults: 50,
      fields: 'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
      expand: 'changelog',
    },
  });
  return data;
}

async function fetchAllIssues(client: AxiosInstance, projectKey: string) {
  const issues: Record<string, unknown>[] = [];
  let startAt = 0;
  let total = 1;

  while (startAt < total) {
    const data = await fetchResolvedIssues(client, projectKey, startAt);
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
    const issues = await fetchAllIssues(client, projectKey);

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
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
    const msg = err instanceof Error ? err.message : 'Sync failed';
    await query(`UPDATE sync_logs SET status='failed', error_message=$2, completed_at=NOW() WHERE id=$1`, [
      logId,
      msg,
    ]);
    throw err;
  }
}

export async function fetchTicketFromJira(userId: string, jiraKey: string) {
  const cfg = await getJiraConfigForUser(userId);
  if (!cfg) throw new Error('Jira not configured');

  const client = createJiraClient(cfg);
  const { data } = await client.get(`/issue/${jiraKey}`, {
    params: {
      fields: 'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
    },
  });
  return parseIssue(data as Record<string, unknown>);
}
