/**
 * NexFlow Cloud demo seed — Jira tickets, comments, relationships, AI recommendations + vector index
 * Run: npm run seed:demo  (from backend/)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_URL = config.aiServiceUrl;

interface DemoComment {
  author: string;
  message: string;
}

interface DemoTicket {
  ticket_id: string;
  project_key: string;
  title: string;
  issue_type: string;
  priority: string;
  severity: string;
  status: string;
  assignee: string;
  reporter: string;
  labels: string[];
  environment: string;
  component: string;
  created_at: string;
  resolved_at: string;
  resolution_time_hours: number;
  description: string;
  stack_trace?: string;
  error_logs?: string;
  affected_services?: string[];
  api_endpoint?: string;
  root_cause: string;
  investigation_summary: string;
  final_resolution: string;
  fix_summary: string;
  deployment_notes?: string;
  related_tickets?: string[];
  comments: DemoComment[];
}

const demoTickets: DemoTicket[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'demo-tickets.json'), 'utf-8')
);

/** Recurring issue cluster → DB category */
function inferCategory(t: DemoTicket): string {
  const tag = [...t.labels, t.component].join(' ').toLowerCase();
  if (tag.includes('auth') || tag.includes('jwt') || tag.includes('login')) return 'authentication';
  if (tag.includes('redis') || tag.includes('timeout')) return 'infrastructure';
  if (tag.includes('react') || tag.includes('hydration') || tag.includes('frontend')) return 'frontend';
  if (tag.includes('payment') || tag.includes('stripe')) return 'billing';
  if (tag.includes('postgresql') || tag.includes('deadlock')) return 'database';
  return 'general';
}

function buildEmbeddingResolution(t: DemoTicket): string {
  return [
    `Root Cause: ${t.root_cause}`,
    `Investigation: ${t.investigation_summary}`,
    `Final Resolution: ${t.final_resolution}`,
    `Fix: ${t.fix_summary}`,
    t.stack_trace ? `Stack Trace: ${t.stack_trace}` : '',
    t.error_logs ? `Error Logs: ${t.error_logs}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildErrorKeywords(t: DemoTicket): string[] {
  const extra = [t.stack_trace, t.error_logs, t.api_endpoint].filter(Boolean) as string[];
  return [...new Set([...t.labels, ...extra.flatMap((s) => s.split(/\W+/).filter((w) => w.length > 3))])].slice(0, 20);
}

async function indexTicket(
  t: DemoTicket,
  ticketId: string,
  commentBodies: string[]
) {
  try {
    await axios.post(`${AI_URL}/embed`, {
      ticketId,
      jiraKey: t.ticket_id,
      title: t.title,
      description: t.description || '',
      comments: commentBodies,
      resolution: buildEmbeddingResolution(t),
      labels: t.labels,
    });
    await pool.query('UPDATE jira_tickets SET embedding_synced = TRUE WHERE id = $1', [ticketId]);
    return true;
  } catch (e) {
    console.warn(`  Index failed for ${t.ticket_id}:`, (e as Error).message);
    return false;
  }
}

async function seed() {
  console.log('Seeding NexFlow Cloud demo data (6 tickets)...');

  const hash = await bcrypt.hash(config.seed.password, 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, 'Admin User', 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [config.seed.email, hash]
  );

  const ticketIds: { id: string; key: string }[] = [];

  for (const t of demoTickets) {
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM jira_tickets WHERE jira_key = $1',
      [t.ticket_id]
    );

    let ticketId: string;
    const category = inferCategory(t);
    const keywords = buildErrorKeywords(t);

    if (existing.rows[0]) {
      ticketId = existing.rows[0].id;
      await pool.query(
        `UPDATE jira_tickets SET
          title=$2, description=$3, resolution_notes=$4, final_fix=$5, root_cause=$6,
          category=$7, affected_module=$8, error_keywords=$9, resolution_time_hours=$10,
          status=$11, resolution='Fixed', issue_type=$12, severity=$13,
          labels=$14, priority=$15, assignee=$16, reporter=$17,
          created_at_jira=$18, resolved_at_jira=$19, raw_payload=$20, updated_at=NOW()
         WHERE id=$1`,
        [
          ticketId,
          t.title,
          t.description,
          t.investigation_summary,
          t.fix_summary,
          t.root_cause,
          category,
          t.component,
          keywords,
          t.resolution_time_hours,
          t.status,
          t.issue_type,
          t.severity,
          t.labels,
          t.priority,
          t.assignee,
          t.reporter,
          t.created_at,
          t.resolved_at,
          JSON.stringify(t),
        ]
      );
    } else {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO jira_tickets (
          jira_key, jira_id, title, description, status, resolution,
          resolution_notes, final_fix, root_cause, category, affected_module,
          error_keywords, resolution_time_hours, created_at_jira, resolved_at_jira,
          issue_type, severity, labels, priority, assignee, reporter, raw_payload
        ) VALUES ($1,$2,$3,$4,$5,'Fixed',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING id`,
        [
          t.ticket_id,
          t.ticket_id,
          t.title,
          t.description,
          t.status,
          t.investigation_summary,
          t.fix_summary,
          t.root_cause,
          category,
          t.component,
          keywords,
          t.resolution_time_hours,
          t.created_at,
          t.resolved_at,
          t.issue_type,
          t.severity,
          t.labels,
          t.priority,
          t.assignee,
          t.reporter,
          JSON.stringify(t),
        ]
      );
      ticketId = ins.rows[0].id;
    }

    ticketIds.push({ id: ticketId, key: t.ticket_id });

    await pool.query('DELETE FROM ticket_comments WHERE ticket_id = $1', [ticketId]);
    for (const c of t.comments) {
      await pool.query(
        `INSERT INTO ticket_comments (ticket_id, author, body) VALUES ($1, $2, $3)`,
        [ticketId, c.author, c.message]
      );
    }

    await pool.query('DELETE FROM ai_recommendations WHERE ticket_id = $1', [ticketId]);
    await pool.query(
      `INSERT INTO ai_recommendations (
        ticket_id, probable_root_cause, recommended_steps, likely_resolution,
        investigation_checklist, possible_fixes, confidence_score, model_used
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'nexflow-seed')`,
      [
        ticketId,
        t.root_cause,
        JSON.stringify([
          'Review stack trace and error logs',
          'Check affected services and API endpoint',
          'Compare with similar historical tickets (AUTH-01 cluster)',
        ]),
        t.final_resolution,
        JSON.stringify([
          'Gather production logs',
          t.investigation_summary,
          'Validate fix in staging before prod deploy',
        ]),
        JSON.stringify([t.fix_summary, t.deployment_notes].filter(Boolean)),
        0.85,
      ]
    );

    console.log(`  Ticket ${t.ticket_id} — ${t.title.slice(0, 50)}...`);
  }

  const keyToId = Object.fromEntries(ticketIds.map((t) => [t.key, t.id]));

  // AUTH-01 cluster: NX-1001 ↔ NX-1006 (duplicate JWT/session issue)
  const relationshipPairs: [string, string, number][] = [
    ['NX-1001', 'NX-1006', 0.94],
  ];

  for (const t of demoTickets) {
    for (const related of t.related_tickets || []) {
      if (keyToId[t.ticket_id] && keyToId[related]) {
        relationshipPairs.push([t.ticket_id, related, 0.94]);
      }
    }
  }

  const seen = new Set<string>();
  for (const [a, b, score] of relationshipPairs) {
    const pairKey = [a, b].sort().join('|');
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    if (keyToId[a] && keyToId[b]) {
      await pool.query(
        `INSERT INTO ticket_relationships (source_ticket_id, related_ticket_id, similarity_score)
         VALUES ($1, $2, $3), ($2, $1, $3)
         ON CONFLICT (source_ticket_id, related_ticket_id) DO UPDATE SET similarity_score = $3`,
        [keyToId[a], keyToId[b], score]
      );
    }
  }

  console.log('\nIndexing tickets in AI service (ensure ai-service is running on port 3002)...');
  let indexed = 0;

  for (const t of demoTickets) {
    const id = keyToId[t.ticket_id];
    const comments = await pool.query<{ body: string }>(
      'SELECT body FROM ticket_comments WHERE ticket_id = $1',
      [id]
    );
    const ok = await indexTicket(t, id, comments.rows.map((c) => c.body));
    if (ok) indexed++;
  }

  console.log(`\nDone! ${demoTickets.length} NexFlow tickets, ${indexed} indexed for vector search.`);
  console.log(`Login: ${config.seed.email} / ${config.seed.password}`);
  console.log('Try chat: "JWT refresh login issue" or "Have we seen Redis timeout before?"');

  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
