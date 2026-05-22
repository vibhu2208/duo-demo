/**
 * Demo seed — tickets, comments, relationships, AI recommendations + vector index
 * Run: npm run seed:demo
 */
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';
import { config } from '../config.js';

const AI_URL = config.aiServiceUrl;

const demoTickets = [
  {
    key: 'DEMO-101',
    title: 'API timeout on /users endpoint under load',
    description:
      'Production API returns 504 after 30s when concurrent users exceed 500. Error in logs: "connection pool exhausted". Started after deploy v2.4.1.',
    resolution:
      'Increased PostgreSQL connection pool from 20 to 80. Added Redis cache for user profile lookups (TTL 5min).',
    rootCause: 'Database connection pool exhaustion under peak traffic',
    category: 'performance',
    module: 'api-gateway',
    keywords: ['timeout', '504', 'connection pool', 'redis'],
    hours: 4.5,
    comments: [
      { author: 'Sarah Chen', body: 'Reproduced in staging with 600 concurrent users using k6.' },
      { author: 'Mike Torres', body: 'Root cause: pool max_connections=20. Bump pool + cache hot paths.' },
    ],
  },
  {
    key: 'DEMO-102',
    title: 'Login fails with OAuth redirect loop',
    description:
      'Users stuck in infinite redirect between app and Okta after SSO config change on Jan 12. Affects all browsers.',
    resolution: 'Fixed callback URL mismatch in OAuth client — changed redirect_uri to match new subdomain.',
    rootCause: 'Misconfigured OAuth callback URL after DNS migration',
    category: 'authentication',
    module: 'auth-service',
    keywords: ['oauth', 'sso', 'redirect', 'okta'],
    hours: 2.0,
    comments: [
      { author: 'Alex Kim', body: 'Redirect URI in Okta was still pointing to old auth.company.com' },
    ],
  },
  {
    key: 'DEMO-103',
    title: 'Dashboard charts show empty data',
    description:
      'Analytics widgets render blank despite data in Snowflake. Only Chrome 120+, started after chart library upgrade.',
    resolution:
      'Patched date-fns parsing for ISO timestamps with timezone offsets. Added unit tests for TZ edge cases.',
    rootCause: 'Timezone parsing regression in chart-library v4',
    category: 'frontend',
    module: 'analytics-ui',
    keywords: ['chart', 'timezone', 'empty', 'chrome'],
    hours: 6.0,
    comments: [
      { author: 'Jordan Lee', body: 'Works in Firefox — Chrome Intl API difference suspected.' },
      { author: 'Jordan Lee', body: 'Confirmed: date-fns parseISO failed on +05:30 offsets.' },
    ],
  },
  {
    key: 'DEMO-104',
    title: 'Webhook deliveries failing with 401 Unauthorized',
    description:
      'Partner webhooks to /hooks/billing return 401 since secret rotation. 12k failed deliveries in queue.',
    resolution: 'Updated HMAC signing secret in Vault and redeployed webhook-worker. Replayed failed queue.',
    rootCause: 'Stale webhook signing secret after Vault rotation',
    category: 'integrations',
    module: 'webhook-worker',
    keywords: ['webhook', '401', 'hmac', 'vault'],
    hours: 3.0,
    comments: [{ author: 'Priya Nair', body: 'Workers were using cached secret from pod startup — needed rolling restart.' }],
  },
  {
    key: 'DEMO-105',
    title: 'Memory leak in background job processor',
    description:
      'worker-jobs pods OOMKilled every 4 hours. Heap grows linearly with queue depth. Node 20, BullMQ 5.',
    resolution:
      'Fixed unclosed DB cursor in processInvoice job. Added explicit connection release in finally block.',
    rootCause: 'Unclosed database cursor in invoice processing job',
    category: 'backend',
    module: 'worker-jobs',
    keywords: ['oom', 'memory leak', 'bullmq', 'cursor'],
    hours: 8.0,
    comments: [
      { author: 'Dev Bot', body: 'Heap dump shows Detached ArrayBuffer growth in pg client.' },
      { author: 'Sarah Chen', body: 'Missing client.release() in processInvoice.ts line 89' },
    ],
  },
  {
    key: 'DEMO-106',
    title: 'Duplicate charges on subscription renewal',
    description:
      'Some users charged twice on monthly renewal. Stripe shows two payment_intents within 200ms. ~0.3% of renewals.',
    resolution:
      'Added idempotency key to Stripe API calls. Backfilled refunds for 847 affected customers.',
    rootCause: 'Missing idempotency key on concurrent renewal cron runs',
    category: 'billing',
    module: 'billing-service',
    keywords: ['stripe', 'duplicate', 'idempotency', 'renewal'],
    hours: 12.0,
    comments: [{ author: 'Finance Ops', body: 'Cron overlapped during DST clock change — two instances ran.' }],
  },
  {
    key: 'DEMO-107',
    title: 'CDN serving stale JavaScript bundles',
    description:
      'Users see old UI after deploy. Hard refresh fixes. CloudFront invalidation not triggered on CI pipeline.',
    resolution: 'Added CloudFront invalidation step to GitLab CI deploy job for /assets/* paths.',
    rootCause: 'Missing CDN cache invalidation in deployment pipeline',
    category: 'devops',
    module: 'frontend-deploy',
    keywords: ['cdn', 'cloudfront', 'stale', 'cache'],
    hours: 1.5,
    comments: [],
  },
  {
    key: 'DEMO-108',
    title: 'Search index returns irrelevant results',
    description:
      'Elasticsearch relevance score dropped after mapping change. Users report top result is unrelated.',
    resolution: 'Reverted analyzer to standard + keyword subfield. Reindexed last 90 days.',
    rootCause: 'Incorrect custom analyzer applied to title field',
    category: 'search',
    module: 'search-service',
    keywords: ['elasticsearch', 'relevance', 'analyzer'],
    hours: 5.0,
    comments: [{ author: 'Search Team', body: 'ngram analyzer caused token explosion on short titles.' }],
  },
  {
    key: 'DEMO-109',
    title: 'Mobile app crash on push notification tap',
    description: 'iOS app crashes (SIGABRT) when opening push deep link to /orders/:id. Android unaffected.',
    resolution: 'Fixed nil optional in OrderCoordinator when order ID parsed from URL fragment.',
    rootCause: 'Force-unwrapped optional navigation parameter on iOS',
    category: 'mobile',
    module: 'ios-app',
    keywords: ['ios', 'crash', 'push', 'deeplink'],
    hours: 4.0,
    comments: [],
  },
  {
    key: 'DEMO-110',
    title: 'Rate limiter blocking internal service calls',
    description:
      'Microservice A gets 429 from API gateway when calling service B. Started after rate limit middleware added.',
    resolution: 'Whitelisted internal service mesh IPs in rate limit config. Added X-Service-Token header bypass.',
    rootCause: 'Global rate limit applied to internal mesh traffic',
    category: 'infrastructure',
    module: 'api-gateway',
    keywords: ['429', 'rate limit', 'internal', 'mesh'],
    hours: 2.5,
    comments: [{ author: 'SRE', body: 'Same root cause pattern as DEMO-101 — gateway config change.' }],
  },
];

async function indexTicket(ticket: {
  id: string;
  jira_key: string;
  title: string;
  description: string;
  resolution_notes: string;
  final_fix: string;
  root_cause: string;
  comments: { body: string }[];
}) {
  try {
    await axios.post(`${AI_URL}/embed`, {
      ticketId: ticket.id,
      jiraKey: ticket.jira_key,
      title: ticket.title,
      description: ticket.description || '',
      comments: ticket.comments.map((c) => c.body),
      resolution: [ticket.resolution_notes, ticket.final_fix, ticket.root_cause].filter(Boolean).join('\n'),
      labels: [],
    });
    return true;
  } catch (e) {
    console.warn(`  Index failed for ${ticket.jira_key}:`, (e as Error).message);
    return false;
  }
}

async function seed() {
  console.log('Seeding demo data to database...');

  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ('admin@example.com', $1, 'Admin User', 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [hash]
  );

  const ticketIds: { id: string; key: string }[] = [];

  for (const t of demoTickets) {
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM jira_tickets WHERE jira_key = $1',
      [t.key]
    );

    let ticketId: string;

    if (existing.rows[0]) {
      ticketId = existing.rows[0].id;
      await pool.query(
        `UPDATE jira_tickets SET
          title=$2, description=$3, resolution_notes=$4, final_fix=$5, root_cause=$6,
          category=$7, affected_module=$8, error_keywords=$9, resolution_time_hours=$10,
          status='Done', resolution='Fixed', issue_type='Bug', severity='high', updated_at=NOW()
         WHERE id=$1`,
        [ticketId, t.title, t.description, t.resolution, t.resolution, t.rootCause, t.category, t.module, t.keywords, t.hours]
      );
    } else {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO jira_tickets (
          jira_key, jira_id, title, description, status, resolution,
          resolution_notes, final_fix, root_cause, category, affected_module,
          error_keywords, resolution_time_hours, resolved_at_jira, issue_type, severity
        ) VALUES ($1,$2,$3,$4,'Done','Fixed',$5,$5,$6,$7,$8,$9,$10,NOW(),'Bug','high')
        RETURNING id`,
        [t.key, t.key, t.title, t.description, t.resolution, t.rootCause, t.category, t.module, t.keywords, t.hours]
      );
      ticketId = ins.rows[0].id;
    }

    ticketIds.push({ id: ticketId, key: t.key });

    await pool.query('DELETE FROM ticket_comments WHERE ticket_id = $1', [ticketId]);
    for (const c of t.comments) {
      await pool.query(
        `INSERT INTO ticket_comments (ticket_id, author, body) VALUES ($1, $2, $3)`,
        [ticketId, c.author, c.body]
      );
    }

    await pool.query('DELETE FROM ai_recommendations WHERE ticket_id = $1', [ticketId]);
    await pool.query(
      `INSERT INTO ai_recommendations (
        ticket_id, probable_root_cause, recommended_steps, likely_resolution,
        investigation_checklist, possible_fixes, confidence_score, model_used
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'demo-seed')`,
      [
        ticketId,
        t.rootCause,
        JSON.stringify([
          'Reproduce in staging',
          'Check logs around incident time',
          'Compare with similar historical tickets',
        ]),
        t.resolution,
        JSON.stringify(['Gather stack traces', 'Review recent deploys', 'Validate fix in staging']),
        JSON.stringify([t.resolution.split('.')[0]]),
        0.75 + Math.random() * 0.2,
      ]
    );

    console.log(`  Ticket ${t.key}`);
  }

  // Similarity relationships (performance cluster)
  const pairs = [
    ['DEMO-101', 'DEMO-110'],
    ['DEMO-102', 'DEMO-104'],
    ['DEMO-103', 'DEMO-107'],
    ['DEMO-105', 'DEMO-106'],
  ];

  const keyToId = Object.fromEntries(ticketIds.map((t) => [t.key, t.id]));

  for (const [a, b] of pairs) {
    if (keyToId[a] && keyToId[b]) {
      await pool.query(
        `INSERT INTO ticket_relationships (source_ticket_id, related_ticket_id, similarity_score)
         VALUES ($1, $2, $3), ($2, $1, $3)
         ON CONFLICT (source_ticket_id, related_ticket_id) DO UPDATE SET similarity_score = $3`,
        [keyToId[a], keyToId[b], 0.82]
      );
    }
  }

  console.log('\nIndexing tickets in AI service (ensure ai-service is running)...');
  let indexed = 0;

  for (const t of demoTickets) {
    const id = keyToId[t.key];
    const comments = await pool.query('SELECT body FROM ticket_comments WHERE ticket_id = $1', [id]);
    const ok = await indexTicket({
      id,
      jira_key: t.key,
      title: t.title,
      description: t.description,
      resolution_notes: t.resolution,
      final_fix: t.resolution,
      root_cause: t.rootCause,
      comments: comments.rows,
    });
    if (ok) indexed++;
  }

  console.log(`\nDone! ${demoTickets.length} tickets, ${indexed} indexed for vector search.`);
  console.log('Login: admin@example.com / admin123');
  console.log('Try chat: "Have we seen this before?" or "What is the root cause?"');

  await pool.end();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
