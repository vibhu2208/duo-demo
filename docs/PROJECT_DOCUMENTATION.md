# Jira Ticket Intelligence — Complete Project Documentation

This document describes **what was built**, **how the architecture works**, **problems encountered** (especially GitLab Duo integration), and **how to run and troubleshoot** the system.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [What we built (deliverables)](#2-what-we-built-deliverables)
3. [System architecture](#3-system-architecture)
4. [Folder structure](#4-folder-structure)
5. [Database design](#5-database-design)
6. [API reference](#6-api-reference)
7. [RAG and AI pipeline](#7-rag-and-ai-pipeline)
8. [GitLab Duo integration](#8-gitlab-duo-integration)
9. [Problems faced and solutions](#9-problems-faced-and-solutions)
10. [Frontend application](#10-frontend-application)
11. [Environment variables](#11-environment-variables)
12. [How to run locally](#12-how-to-run-locally)
13. [Deployment](#13-deployment)
14. [Known limitations](#14-known-limitations)
15. [Troubleshooting](#15-troubleshooting)
16. [Related documents](#16-related-documents)

---

## 1. Project overview

### Purpose

An **MVP** that helps engineers resolve Jira tickets faster by:

- Syncing historical resolved tickets from Jira
- Finding **semantically similar** past incidents
- Generating **AI recommendations** (root cause, debugging steps, fixes)
- Providing a **chat assistant** grounded on ticket history

### MVP constraints (by design)

| Included | Excluded (post-MVP) |
|----------|---------------------|
| Jira Cloud REST API | GitLab CI/CD integration |
| PostgreSQL (Neon) | Kubernetes complexity |
| GitLab Duo for LLM | GitLab as ticket source |
| Local / Chroma vector search | Full OpenAI dependency for chat |
| JWT auth, demo seed data | Real-time Jira webhooks |

---

## 2. What we built (deliverables)

### Backend (`backend/`)

- Express.js REST API with JWT authentication
- PostgreSQL schema (users, tickets, comments, embeddings metadata, AI recommendations, chat sessions)
- Jira sync engine (fetch resolved issues, parse ADF text, store comments)
- Services: tickets, chat, analytics, Jira config
- Neon-compatible SSL database connection
- Demo seed script: `npm run seed:demo` (10 sample tickets + vector index)
- **Database context injection for chat** — loads tickets from Postgres into every Duo prompt

### AI service (`ai-service/`)

- Separate microservice for embeddings, vector search, and LLM calls
- **Three LLM providers:** `gitlab` | `openai` | `mock` (explicit only)
- **Embeddings:** local hash-based (default) or OpenAI
- **Vector store:** ChromaDB with in-memory fallback
- **RAG:** analyze ticket, generate recommendations, chat with context
- **GitLab Duo via GraphQL** `aiAction` (not REST on gitlab.com)

### Frontend (`frontend/`)

- React + TypeScript + Vite + Tailwind + ShadCN-style components
- React Query for data fetching
- Pages: Login, Dashboard, Ticket Search, Ticket Detail, Duo Chat, Similar Explorer, Admin Sync
- Dark/light mode, collapsible sidebar
- AI status banner on chat page (shows if Duo is ready)

### Infrastructure

- Docker Compose: Postgres, Redis, Chroma, backend, ai-service, frontend
- Deployment notes for Render (backend + AI) and Vercel (frontend)
- Documentation in `docs/`

---

## 3. System architecture

### High-level diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                                    │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTP
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React, port 5173)                                              │
│  - Login, Dashboard, Tickets, Chat, Similar Explorer, Admin Sync          │
│  - Proxies /api → Backend in dev (vite.config.ts)                         │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ /api/*
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Express, port 3001)                                             │
│  - Auth (JWT)                                                             │
│  - Jira sync → PostgreSQL                                                 │
│  - On chat: read PostgreSQL tickets → build dbContext                     │
│  - Orchestrates calls to AI service                                       │
└───────────────┬──────────────────────────────┬───────────────────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────────┐    ┌──────────────────────────────────────────┐
│  PostgreSQL (Neon)        │    │  AI SERVICE (Express, port 3002)          │
│  - jira_tickets           │    │  - Embed tickets                          │
│  - comments, AI recs      │    │  - Vector search (memory / Chroma)        │
│  - chat_sessions          │    │  - RAG chat → GitLab Duo GraphQL          │
└───────────────────────────┘    └──────────────────────┬───────────────────┘
                                                          │
                ┌─────────────────────────────────────────┼─────────────────┐
                ▼                                         ▼                 ▼
        ┌───────────────┐                        ┌──────────────┐   ┌─────────────┐
        │  Jira Cloud   │                        │ GitLab Duo   │   │  ChromaDB   │
        │  REST API     │                        │ GraphQL API  │   │  (optional) │
        └───────────────┘                        └──────────────┘   └─────────────┘
```

### Important: GitLab Duo does NOT access your database

GitLab Duo is **not** connected to PostgreSQL, Jira, or Chroma directly.

| Step | Who does it |
|------|-------------|
| Store tickets | Backend → PostgreSQL |
| Search similar tickets | AI service → vector index |
| Load ticket text for chat | Backend → PostgreSQL → sent in HTTP body to AI service |
| Generate natural language answer | AI service → GitLab Duo API |

Duo only sees **text in the prompt** for each request. If Duo says “I don’t have context,” the prompt did not include enough ticket data (or vector index was empty).

### Chat request flow (detailed)

```
1. User sends message in Duo Chat UI
2. Frontend → POST /api/chat/query (with JWT)
3. Backend:
   a. Loads current ticket context (if ticketId in URL)
   b. getDatabaseContextForChat() — queries PostgreSQL for up to 8 relevant tickets
   c. Saves user message to chat_messages
   d. POST http://ai-service:3002/chat with message, dbContext, dbStats, history
4. AI service (ragChat):
   a. If greeting ("Hey") → short welcome (no Duo call)
   b. Vector search on in-memory/Chroma index
   c. Filter matches with similarity ≥ 12%
   d. Build prompt: system rules + DB tickets + vector matches + user question
   e. gitlabChatCompletion → gitlabChatViaGraphql (GraphQL aiAction)
   f. Poll aiMessages by requestId until assistant reply arrives
   g. formatChatAnswer (convert JSON to markdown if needed)
5. Backend saves assistant message, returns answer + sources to frontend
```

### Jira sync flow

```
Admin → POST /api/jira/sync
  → Jira REST API (JQL: resolved issues)
  → Parse title, description, comments, resolution
  → INSERT/UPDATE jira_tickets, ticket_comments in PostgreSQL
  → POST /embed to AI service for each ticket
  → Vector stored in memory map and/or ChromaDB
```

---

## 4. Folder structure

```
cg/
├── frontend/                 # React UI
│   └── src/
│       ├── pages/            # Login, Dashboard, Tickets, Chat, Similar, Admin
│       ├── components/       # Layout, UI, chat/MarkdownText
│       ├── contexts/         # AuthContext
│       └── lib/              # api.ts, utils
├── backend/                  # Main API
│   └── src/
│       ├── routes/           # auth, jira, tickets, chat, analytics, ai
│       ├── services/         # jira, ticket, chat
│       ├── db/               # schema.sql, migrate, seed-demo
│       └── middleware/       # auth
├── ai-service/               # AI / RAG / embeddings
│   └── src/
│       ├── lib/
│       │   ├── llm/          # gitlab-duo, gitlab-graphql, openai, mock
│       │   ├── embeddings.ts
│       │   ├── vector-store.ts
│       │   └── chroma.ts
│       └── services/         # rag.service.ts
├── docker/                   # docker-compose.yml
├── docs/                     # All documentation
└── .env                      # Shared environment (not committed)
```

---

## 5. Database design

Primary store: **PostgreSQL** (Neon in production).

| Table | Purpose |
|-------|---------|
| `users` | Login, roles (admin/user) |
| `jira_config` | Per-user Jira credentials (optional; can use .env) |
| `jira_tickets` | Synced ticket body, metadata, AI-extracted fields |
| `ticket_comments` | Developer comments from Jira |
| `ticket_embeddings` | Maps ticket UUID → Chroma ID |
| `ticket_relationships` | Cached similarity edges |
| `ai_recommendations` | Stored analysis results per ticket |
| `chat_sessions` / `chat_messages` | Chat history |
| `sync_logs` | Jira sync audit |
| `analytics_events` | Dashboard metrics |

Full column reference: [DATABASE.md](./DATABASE.md)

---

## 6. API reference

Base URL (local): `http://localhost:3001/api`

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login → JWT |
| POST | `/auth/register` | Register |
| GET | `/auth/me` | Current user (requires JWT) |

### Jira

| Method | Path | Description |
|--------|------|-------------|
| GET | `/jira/config` | Connection status |
| PUT | `/jira/config` | Save credentials (admin) |
| POST | `/jira/sync` | Sync resolved tickets (admin) |
| GET | `/jira/sync/logs` | Sync history |

### Tickets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tickets` | List / search |
| GET | `/tickets/:id` | Detail + comments + recommendation |
| GET | `/tickets/:id/similar` | Vector similar tickets |
| POST | `/tickets/:id/analyze` | Run AI analysis |
| POST | `/tickets/import` | Import single ticket by Jira key |

### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/query` | RAG chat message |
| GET | `/chat/sessions` | User sessions |
| GET | `/chat/sessions/:id/messages` | Session messages |

### AI / Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ai/status` | Proxies AI service health (Duo ready?, vector count) |
| GET | `/analytics/summary` | Dashboard stats |

### AI service (internal, port 3002)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Provider status, memoryVectors count |
| POST | `/embed` | Index one ticket |
| POST | `/search/similar` | Vector search |
| POST | `/analyze` | Extract metadata |
| POST | `/recommend` | Generate recommendation JSON |
| POST | `/chat` | RAG chat |

---

## 7. RAG and AI pipeline

### Step 1 — Ingest (Jira sync or seed)

- Text built from: title + description + comments + resolution
- Cleaned and concatenated (`ai-service/src/lib/text.ts`)

### Step 2 — Embed

- `EMBEDDING_PROVIDER=local`: deterministic hash vector (384 dims) — no API key
- `EMBEDDING_PROVIDER=openai`: OpenAI `text-embedding-3-small`
- Stored in in-memory `Map` and optionally ChromaDB

### Step 3 — Retrieve (on question)

- Cosine similarity against all indexed tickets
- Minimum similarity threshold: **12%** (`MIN_SIMILARITY`)
- Backend **also** loads tickets directly from PostgreSQL (keyword + recent)

### Step 4 — Generate (GitLab Duo)

- System prompt explains Duo has database context in the message
- User prompt includes: current ticket, DB snapshot, vector matches, question
- Response formatted as markdown (raw JSON converted if model returns JSON)

### Providers (`AI_PROVIDER`)

| Value | Behavior |
|-------|----------|
| `gitlab` | Real GitLab Duo via GraphQL (production intent) |
| `openai` | OpenAI chat completions (needs `OPENAI_API_KEY`) |
| `mock` | Template responses — **only if explicitly set**; not default |

---

## 8. GitLab Duo integration

### What we intended

Use **GitLab Duo** as the LLM for chat, analysis, and recommendations — aligned with Capgemini / enterprise GitLab usage.

### Integration approaches tried

#### Attempt 1: REST Chat Completions API

```
POST {GITLAB_URL}/api/v4/chat/completions
Authorization: Bearer {GITLAB_TOKEN}
Body: { content, additional_context, project_id? }
```

**Documented by GitLab:** [Chat Completions API](https://docs.gitlab.com/api/chat/)

**Result on GitLab.com:** `404 Not Found` — endpoint not exposed to normal PAT users (internal / self-managed with feature flag only).

#### Attempt 2: GraphQL `aiAction` mutation (current solution)

```
POST {GITLAB_URL}/api/graphql
mutation { aiAction(input: { chat: { resourceId, content }, clientSubscriptionId }) { requestId threadId errors } }
```

Then **poll** `aiMessages` until a message with matching `requestId` and assistant role appears.

**Result:** Works with valid PAT (`api` scope). Tested successfully (`SUCCESS: OK`).

### Files involved

| File | Role |
|------|------|
| `ai-service/src/lib/llm/gitlab-duo.ts` | Routes REST vs GraphQL; token validation |
| `ai-service/src/lib/llm/gitlab-graphql.ts` | GraphQL aiAction + polling |
| `ai-service/src/lib/llm/index.ts` | Provider router (no silent mock fallback) |
| `ai-service/src/config.ts` | Env, token validation cache, setup status |

### GitLab Duo does NOT have

- Direct SQL / Neon access
- Automatic read of all tickets without our backend sending them
- Public embeddings API (we use local or OpenAI embeddings instead)

---

## 9. Problems faced and solutions

### Problem 1: PostgreSQL connection refused (`ECONNREFUSED :5432`)

| Symptom | `npm run migrate` failed — nothing listening on localhost:5432 |
|---------|------------------------------------------------------------------|
| Cause | `.env` pointed to local Docker Postgres; Docker not running |
| Fix | Switched `DATABASE_URL` to **Neon** cloud PostgreSQL; enabled SSL in `pool.ts` |

---

### Problem 2: Login not working

| Symptom | 401 or empty users table |
|---------|--------------------------|
| Cause | Migration never ran (Problem 1) |
| Fix | Ran `npm run migrate` on Neon; seeded admin `admin@example.com` / `admin123` |

---

### Problem 3: GitLab token 401 Unauthorized

| Symptom | Chat 500; `USER API 401` in tests |
|---------|-----------------------------------|
| Cause | Invalid, expired, or wrong-scope PAT; empty `GITLAB_TOKEN` in `.env` |
| Fix | Create new PAT with **`api`** scope; update `.env`; restart ai-service |
| Validation | `GET /api/v4/user` must return 200 + username |

---

### Problem 4: Chat API 404 Not Found

| Symptom | `[chat] GitLab API error (404): 404 Not Found` |
|---------|------------------------------------------------|
| Cause | `POST /api/v4/chat/completions` **does not exist** on GitLab.com for standard users |
| Fix | Implemented **GraphQL `aiAction`** path in `gitlab-graphql.ts`; auto-used for `gitlab.com` URLs |

---

### Problem 5: Chat 500 — generic “Request failed”

| Symptom | Frontend shows axios 500; backend returns short error body |
|---------|--------------------------------------------------------------|
| Cause | Errors from AI service not propagated through `ai-client.ts` |
| Fix | `aiClient.chat` rethrows `response.data.error`; improved GitLab error messages |

---

### Problem 6: Nonsense replies (JSON about DEMO-106 for “Hey”)

| Symptom | User says “Hey”; gets full JSON root-cause analysis + `DEMO-106 0%` source |
|---------|-------------------------------------------------------------------------------|
| Causes | (a) Stale message from GitLab poll (wrong `requestId`) (b) Weak 0% similarity still shown (c) Mock/hardcoded templates when `AI_PROVIDER=mock` (d) Duo confused by huge irrelevant prompt |
| Fixes | Greeting handler skips heavy RAG; poll **only** by `requestId`; filter sources ≥ 12%; removed silent mock default; prompt rules: plain English, no JSON |

---

### Problem 7: Duo says “I don’t have context”

| Symptom | Duo claims no ticket data despite DB having tickets |
|---------|-----------------------------------------------------|
| Causes | Vector index empty after ai-service restart; prompt said “no matches”; Duo never received Postgres text |
| Fixes | `getDatabaseContextForChat()` sends up to 8 tickets from PostgreSQL on every chat; prompt explicitly states Duo has database access |

---

### Problem 8: In-memory vectors lost on restart

| Symptom | `memoryVectors: 0` in `/health`; similarity always weak |
|---------|----------------------------------------------------------|
| Cause | `USE_CHROMA=false` uses RAM-only `Map` in ai-service |
| Fix | Run `npm run seed:demo` after each ai-service restart; or enable Chroma in Docker |

---

### Problem 9: Hardcoded mock AI (user concern)

| Symptom | Responses felt templated, not real Duo |
|---------|----------------------------------------|
| Cause | `AI_PROVIDER=mock` was default earlier |
| Fix | Default `gitlab`; mock only when explicitly set; GraphQL for real Duo |

---

### Timeline summary (GitLab Duo)

```
Plan:     REST /api/v4/chat/completions
          ↓
Fail:     401 (bad token) → fixed PAT
          ↓
Fail:     404 (endpoint not on gitlab.com) → switched to GraphQL aiAction
          ↓
Fail:     Wrong/stale polled messages → requestId-only polling
          ↓
Fail:     "No context" / irrelevant JSON → DB context injection + prompt fixes
          ↓
Current:  GraphQL Duo + PostgreSQL context + vector search (when indexed)
```

---

## 10. Frontend application

| Route | Page | Features |
|-------|------|----------|
| `/login` | Login | JWT auth |
| `/` | Dashboard | Stats, recent tickets, recurring issues |
| `/tickets` | Ticket Search | Search, import by Jira key |
| `/tickets/:id` | Ticket Detail | AI analyze, similar tickets, comments |
| `/chat` | Duo Chat | RAG chat, quick prompts, AI status banner |
| `/similar` | Similar Explorer | Pick ticket, vector search |
| `/admin` | Sync Settings | Jira credentials, sync button |

Tech: Vite, React Router, TanStack Query, Tailwind, Lucide icons.

---

## 11. Environment variables

Shared `.env` at repo root (see `.env.example`).

### Critical variables

```env
# Database (Neon)
DATABASE_URL=postgresql://...@....neon.tech/neondb?sslmode=require

# AI
AI_PROVIDER=gitlab
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-...
GITLAB_PROJECT_ID=          # optional numeric project ID

EMBEDDING_PROVIDER=local
USE_CHROMA=false

# Services
BACKEND_PORT=3001
AI_SERVICE_URL=http://localhost:3002
FRONTEND_URL=http://localhost:5173

# Auth
JWT_SECRET=long-random-string

# Jira (optional if using Admin UI)
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
```

### GITLAB_PROJECT_ID

Numeric ID from GitLab → Project → Settings → General. Optional for GraphQL chat; required for some REST resource types.

---

## 12. How to run locally

### Prerequisites

- Node.js 20+
- Neon (or Docker Postgres)
- GitLab PAT with `api` scope + Duo enabled on subscription

### Steps

```powershell
# 1. Configure
copy .env.example .env
# Edit DATABASE_URL, GITLAB_TOKEN, etc.

# 2. Install
cd backend && npm install
cd ../ai-service && npm install
cd ../frontend && npm install

# 3. Database
cd ../backend
npm run migrate
npm run seed:demo

# 4. Run (3 terminals)
cd ai-service && npm run dev    # port 3002
cd backend && npm run dev       # port 3001
cd frontend && npm run dev      # port 5173
```

Login: `admin@example.com` / `admin123`

Verify Duo: `GET http://localhost:3002/health` → `aiReady: true`, `providerLabel: "GitLab Duo"`

---

## 13. Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Vercel | `vercel.json` proxies `/api` to backend |
| Backend | Render | `DATABASE_URL`, `AI_SERVICE_URL`, `JWT_SECRET` |
| AI service | Render | `GITLAB_*`, `AI_PROVIDER=gitlab` |
| Database | Neon | SSL required |

Details: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 14. Known limitations

1. **GitLab Duo REST** not available on gitlab.com — GraphQL only.
2. **GraphQL chat is async** — poll up to ~45s; slower than direct OpenAI.
3. **Vector index in RAM** — lost on ai-service restart unless Chroma or re-seed.
4. **Duo sees prompt snapshot only** — not live query of full DB (we send up to 8 tickets).
5. **Jira sync** manual/on-demand — no webhooks in MVP.
6. **GitLab.com Duo** may require Ultimate + Duo license; 403 possible on restricted plans.
7. **Embeddings** are local hash for demo — not as accurate as OpenAI embeddings.

---

## 15. Troubleshooting

| Issue | Check | Action |
|-------|-------|--------|
| Chat 500 | ai-service logs `[chat]` | Read error message; fix token or Duo access |
| `aiReady: false` | `/api/ai/status` | Fix `GITLAB_TOKEN`; restart ai-service |
| 404 on chat | Using gitlab.com | Ensure latest code uses GraphQL (not REST only) |
| No similar tickets | `/health` → `memoryVectors` | Run `npm run seed:demo` |
| Duo “no context” | Ticket count in DB | `seed:demo` or Jira sync; restart backend |
| Analytics 500 | Redis optional | Redis failure is non-fatal; check Postgres |
| Wrong JSON reply | Old ai-service | Pull latest; greeting should not trigger analysis |

### Health checks

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
```

### Test GitLab token

```bash
cd ai-service
node scripts/test-gitlab.mjs
```

### Test GraphQL chat

```bash
cd ai-service
npm run build
node scripts/test-graphql-chat.mjs
```

---

## 16. Related documents

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Shorter architecture overview |
| [DATABASE.md](./DATABASE.md) | Full schema |
| [GITLAB_DUO.md](./GITLAB_DUO.md) | Duo-specific setup |
| [ROADMAP.md](./ROADMAP.md) | Future phases |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Render + Vercel |
| [../README.md](../README.md) | Quick start |

---

## Document history

| Date | Changes |
|------|---------|
| MVP build | Initial monorepo, Jira sync, OpenAI/Chroma, mock mode |
| Integration hardening | Neon DB, JWT login, demo seed |
| GitLab Duo | REST attempt → 404 → GraphQL aiAction |
| Chat quality | DB context injection, greeting handler, similarity filter |
| Documentation | This master document |

---

*Generated for the Jira Ticket Intelligence MVP — Capgemini / research project workspace.*
