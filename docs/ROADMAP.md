# Implementation Roadmap

## Phase 1 — Foundation (Week 1) ✅ Starter Code

- [x] Monorepo structure (`frontend/`, `backend/`, `ai-service/`, `docker/`)
- [x] PostgreSQL schema + migrations
- [x] JWT authentication
- [x] Docker Compose (Postgres, Redis, Chroma, services)
- [x] Express API skeleton

## Phase 2 — Jira Integration (Week 1-2)

- [x] Jira REST client (search, issue fetch)
- [x] ADF text extraction
- [x] Sync engine for resolved tickets
- [x] Admin UI for credentials + manual sync
- [ ] **Your task:** Add Jira credentials to `.env` and run first sync
- [ ] Webhook listener for real-time ticket updates (post-MVP)

## Phase 3 — AI Pipeline (Week 2)

- [x] OpenAI embeddings integration
- [x] ChromaDB upsert + similarity search
- [x] Ticket analysis (issue type, module, keywords)
- [x] Recommendation engine with confidence score
- [ ] Tune embedding document format for your ticket patterns
- [ ] Add re-ranking (cross-encoder) if similarity quality is low

## Phase 4 — Frontend (Week 2-3)

- [x] Login, Dashboard, Ticket Search, Detail, Chat, Similar Explorer, Admin
- [x] Dark/light mode, responsive sidebar
- [x] React Query data fetching
- [ ] Add loading skeletons and toast notifications
- [ ] E2E tests with Playwright

## Phase 5 — Production (Week 3-4)

| Task | Platform |
|------|----------|
| Frontend deploy | Vercel |
| Backend + AI service | Railway / Render |
| Database | Railway Postgres / Supabase |
| ChromaDB | Chroma Cloud or self-hosted |
| Secrets | Environment variables per service |

### Production checklist

1. Rotate `JWT_SECRET` and use strong values
2. Encrypt Jira API tokens at rest
3. Enable HTTPS everywhere
4. Set up Jira sync cron (daily) via Railway cron or GitHub Actions
5. Add rate limiting on `/api/chat/query`
6. Monitor OpenAI token usage and costs
7. Add structured logging (Pino + Datadog)

## Phase 6 — Post-MVP Enhancements

- Jira webhook for automatic indexing on ticket create/update
- Slack/Teams notifications for high-confidence matches
- Feedback loop: "Was this helpful?" on recommendations
- Fine-tuned embedding model on your ticket corpus
- Multi-project support with project-scoped collections
- Role-based access per Jira project

## Quick Start Commands

```bash
# 1. Copy env
cp .env.example .env

# 2. Start infrastructure
cd docker && docker compose up -d postgres redis chroma

# 3. Install & migrate
npm run install:all
cd backend && npm run migrate

# 4. Run services (3 terminals)
cd ai-service && npm run dev
cd backend && npm run dev
cd frontend && npm run dev
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Similar ticket recall@5 | > 70% on labeled test set |
| Time to first recommendation | < 5 seconds |
| Chat response latency | < 8 seconds |
| Sync throughput | 100 tickets/min |
