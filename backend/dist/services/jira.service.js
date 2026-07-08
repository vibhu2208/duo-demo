import https from 'https';
import axios, { isAxiosError } from 'axios';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { aiClient } from '../lib/ai-client.js';
function getApiBaseUrl(cfg) {
    const base = cfg.baseUrl.replace(/\/$/, '');
    return cfg.deploymentType === 'server' ? `${base}/rest/api/2` : `${base}/rest/api/3`;
}
function createJiraClient(cfg) {
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
function adfToText(node) {
    if (!node || typeof node !== 'object')
        return '';
    const n = node;
    if (n.type === 'text' && typeof n.text === 'string')
        return n.text;
    if (Array.isArray(n.content)) {
        return n.content.map(adfToText).join('\n');
    }
    return '';
}
function extractDescription(desc) {
    if (!desc)
        return '';
    if (typeof desc === 'string')
        return desc;
    return adfToText(desc);
}
const JIRA_ENV_PLACEHOLDERS = [
    'your-company.internal',
    'your-jira-username',
    'your-jira-password',
    'your-atlassian-api-token',
    'your-password-or-pat',
];
function isPlaceholderJiraEnvValue(value) {
    const lower = value.toLowerCase();
    return JIRA_ENV_PLACEHOLDERS.some((p) => lower.includes(p));
}
export function getJiraConfigFromEnv() {
    const { baseUrl, username, apiToken, projectKey, deploymentType, insecureSsl } = config.jira;
    if (!baseUrl || !username || !apiToken)
        return null;
    if (isPlaceholderJiraEnvValue(baseUrl) ||
        isPlaceholderJiraEnvValue(username) ||
        isPlaceholderJiraEnvValue(apiToken)) {
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
function parseSyncFilter(value) {
    if (value === 'closed' || value === 'both')
        return value;
    return 'resolved';
}
async function getJiraConfigFromDb(userId) {
    const { rows } = await query('SELECT base_url, email, api_token_encrypted, project_key, deployment_type, sync_filter, insecure_ssl FROM jira_config WHERE user_id = $1 LIMIT 1', [userId]);
    if (!rows[0])
        return null;
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
export async function getJiraConfigForUser(userId) {
    const db = await getJiraConfigFromDb(userId);
    if (db)
        return db;
    return getJiraConfigFromEnv();
}
export async function saveJiraConfig(userId, data) {
    await query(`INSERT INTO jira_config (user_id, base_url, email, api_token_encrypted, project_key, deployment_type, sync_filter, insecure_ssl)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       email = EXCLUDED.email,
       api_token_encrypted = EXCLUDED.api_token_encrypted,
       project_key = EXCLUDED.project_key,
       deployment_type = EXCLUDED.deployment_type,
       sync_filter = EXCLUDED.sync_filter,
       insecure_ssl = EXCLUDED.insecure_ssl,
       updated_at = NOW()`, [
        userId,
        data.baseUrl,
        data.username,
        data.apiToken,
        data.projectKey || null,
        data.deploymentType || 'server',
        data.syncFilter || 'resolved',
        data.insecureSsl === true,
    ]);
}
const SYNC_FILTER_LABELS = {
    resolved: 'Resolved (has resolution)',
    closed: 'Closed status',
    both: 'Resolved or Closed',
};
function authFailureMessage(status, detail) {
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
export async function testJiraConnection(userId, overrides) {
    const testedAt = new Date().toISOString();
    const saved = await getJiraConfigForUser(userId);
    const cfg = saved
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
        const { data: myself, status } = await client.get(myselfPath);
        const details = {
            ...baseDetails,
            jiraUsername: myself.name || myself.key,
            displayName: myself.displayName,
            emailAddress: myself.emailAddress,
        };
        if (cfg.deploymentType === 'server') {
            try {
                const { data: serverInfo } = await client.get('/serverInfo');
                details.serverVersion = serverInfo.version;
                details.serverTitle = serverInfo.serverTitle;
            }
            catch {
                // optional
            }
        }
        if (cfg.projectKey) {
            try {
                const { data: project } = await client.get(`/project/${cfg.projectKey}`);
                details.projectAccessible = true;
                details.projectName = project.name;
            }
            catch {
                details.projectAccessible = false;
            }
        }
        try {
            const jql = buildSyncIssuesJql(cfg.projectKey || '', cfg.deploymentType, cfg.syncFilter);
            const searchPath = cfg.deploymentType === 'server' ? '/search' : '/search/jql';
            const { data: searchResult } = await client.get(searchPath, {
                params: { jql, startAt: 0, maxResults: 0 },
            });
            details.matchingTicketCount = searchResult.total ?? 0;
        }
        catch {
            // search may fail even when auth works — reported separately if needed
        }
        let message = `Authorization successful (HTTP ${status ?? 200}). Logged in as ${details.displayName || details.jiraUsername}.`;
        if (cfg.projectKey && details.projectAccessible === false) {
            message += ` Warning: project "${cfg.projectKey}" was not found or is not accessible.`;
        }
        else if (cfg.projectKey && details.projectName) {
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
    }
    catch (err) {
        const httpStatus = isAxiosError(err) ? err.response?.status : undefined;
        const detail = formatJiraApiError(err);
        let message = authFailureMessage(httpStatus, detail);
        if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|certificate|UNABLE_TO_VERIFY/i.test(detail)) {
            if (/certificate|UNABLE_TO_VERIFY/i.test(detail)) {
                message = `Cannot connect securely to ${cfg.baseUrl}. Enable "Allow self-signed certificate" if using internal HTTPS (e.g. port 8443). (${detail})`;
            }
            else {
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
function formatJiraApiError(err) {
    if (!isAxiosError(err)) {
        return err instanceof Error ? err.message : 'Sync failed';
    }
    const status = err.response?.status;
    const data = err.response?.data;
    if (data && typeof data === 'object') {
        const messages = data.errorMessages;
        if (messages?.length) {
            return `Jira API error (${status}): ${messages.join('; ')}`;
        }
        const errors = data.errors;
        if (errors && Object.keys(errors).length) {
            return `Jira API error (${status}): ${Object.values(errors).join('; ')}`;
        }
        const message = data.message;
        if (message) {
            return `Jira API error (${status}): ${message}`;
        }
    }
    return err.message;
}
function buildSyncIssuesJql(projectKey, deploymentType, syncFilter) {
    const orderBy = syncFilter === 'closed'
        ? 'updated DESC'
        : deploymentType === 'server'
            ? 'resolutiondate DESC'
            : 'updated DESC';
    let statusClause;
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
async function fetchResolvedIssues(client, deploymentType, projectKey, syncFilter, startAt = 0) {
    const jql = buildSyncIssuesJql(projectKey, deploymentType, syncFilter);
    const params = {
        jql,
        startAt,
        maxResults: 50,
        fields: 'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
    };
    const searchPath = deploymentType === 'server' ? '/search' : '/search/jql';
    const { data } = await client.get(searchPath, { params });
    return data;
}
async function fetchAllIssues(client, deploymentType, projectKey, syncFilter) {
    const issues = [];
    let startAt = 0;
    let total = 1;
    while (startAt < total) {
        const data = await fetchResolvedIssues(client, deploymentType, projectKey, syncFilter, startAt);
        const batch = (data.issues || []);
        issues.push(...batch);
        total = data.total;
        startAt += batch.length;
        if (batch.length === 0)
            break;
    }
    return issues;
}
function parseIssue(issue) {
    const fields = issue.fields;
    const key = issue.key;
    const id = issue.id;
    const title = fields.summary || '';
    const description = extractDescription(fields.description);
    const status = fields.status?.name || 'Unknown';
    const priority = fields.priority?.name || null;
    const labels = fields.labels || [];
    const assignee = fields.assignee?.displayName || null;
    const reporter = fields.reporter?.displayName || null;
    const issueType = fields.issuetype?.name || null;
    const resolution = fields.resolution?.name || null;
    const created = fields.created;
    const resolved = fields.resolutiondate;
    const comments = [];
    const commentField = fields.comment;
    if (commentField?.comments) {
        for (const c of commentField.comments) {
            comments.push({
                id: c.id,
                author: c.author?.displayName || 'Unknown',
                body: extractDescription(c.body),
                created: c.created,
            });
        }
    }
    const resolutionNotes = comments
        .filter((c) => /fix|resolv|root cause|solution|workaround/i.test(c.body))
        .map((c) => c.body)
        .join('\n---\n');
    const finalFix = comments.length > 0 ? comments[comments.length - 1].body : resolutionNotes;
    let resolutionTimeHours = null;
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
export async function syncJiraTickets(userId) {
    const cfg = await getJiraConfigForUser(userId);
    if (!cfg)
        throw new Error('Jira not configured. Set credentials in Admin Sync Settings or .env');
    const client = createJiraClient(cfg);
    const projectKey = cfg.projectKey || config.jira.projectKey || '';
    const log = await query(`INSERT INTO sync_logs (status) VALUES ('running') RETURNING id`);
    const logId = log.rows[0].id;
    let created = 0;
    let skipped = 0;
    let embeddingsIndexed = 0;
    const { rows: existingRows } = await query('SELECT jira_key FROM jira_tickets');
    const knownKeys = new Set(existingRows.map((r) => r.jira_key));
    try {
        const issues = await fetchAllIssues(client, cfg.deploymentType, projectKey, cfg.syncFilter);
        for (const issue of issues) {
            const parsed = parseIssue(issue);
            if (knownKeys.has(parsed.jiraKey)) {
                skipped++;
                continue;
            }
            const ins = await query(`INSERT INTO jira_tickets (
          jira_key, jira_id, title, description, status, priority, labels,
          assignee, reporter, issue_type, resolution, resolution_notes, final_fix,
          resolution_time_hours, created_at_jira, resolved_at_jira, raw_payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING id`, [
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
            ]);
            const ticketId = ins.rows[0].id;
            knownKeys.add(parsed.jiraKey);
            created++;
            for (const c of parsed.comments) {
                await query(`INSERT INTO ticket_comments (ticket_id, jira_comment_id, author, body, created_at_jira)
           VALUES ($1, $2, $3, $4, $5)`, [ticketId, c.id, c.author, c.body, c.created ? new Date(c.created) : null]);
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
                    await query(`INSERT INTO ticket_embeddings (ticket_id, chroma_id, embedding_model, content_hash)
             VALUES ($1, $2, 'text-embedding-3-small', $3)
             ON CONFLICT (ticket_id) DO UPDATE SET chroma_id=$2, updated_at=NOW()`, [ticketId, embedResult.chromaId, `${parsed.jiraKey}-${Date.now()}`]);
                    await query('UPDATE jira_tickets SET embedding_synced = true WHERE id = $1', [ticketId]);
                    embeddingsIndexed++;
                }
            }
            catch (embedErr) {
                console.warn(`Embedding failed for ${parsed.jiraKey}:`, embedErr);
            }
        }
        await query(`UPDATE sync_logs SET completed_at=NOW(), tickets_fetched=$2, tickets_created=$3,
       tickets_updated=$4, embeddings_indexed=$5, status='completed' WHERE id=$1`, [logId, issues.length, created, skipped, embeddingsIndexed]);
        await query(`UPDATE jira_config SET last_sync_at=NOW(), sync_status='completed', updated_at=NOW()
       WHERE user_id=$1`, [userId]).catch(() => { });
        return { fetched: issues.length, created, updated: 0, skipped, embeddingsIndexed };
    }
    catch (err) {
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
export async function fetchTicketFromJira(userId, jiraKey) {
    const cfg = await getJiraConfigForUser(userId);
    if (!cfg)
        throw new Error('Jira not configured');
    const client = createJiraClient(cfg);
    const { data } = await client.get(`/issue/${jiraKey}`, {
        params: {
            fields: 'summary,description,status,priority,labels,assignee,reporter,created,resolution,resolutiondate,comment,issuetype',
        },
    });
    return parseIssue(data);
}
