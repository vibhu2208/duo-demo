# Architecture — Jira Ticket Intelligence MVP

> Full documentation including GitLab Duo integration issues: **[PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md)**

## System Overview

The platform is a **three-tier monorepo** optimized for fast MVP delivery:

| Layer | Technology | Responsibility |
|-------|------------|----------------|
| Frontend | React, TypeScript, Tailwind, ShadCN-style UI, React Query | Dashboard, ticket views, chat UI |
| Backend | Node.js, Express, PostgreSQL, Redis | Auth, Jira sync, REST APIs, orchestration |
| AI Service | Node.js, OpenAI, ChromaDB, LangChain-compatible RAG | Embeddings, vector search, LLM calls |

## Data Flow

### 1. Jira Sync Pipeline

```
Jira REST API → Backend (jira.service) → PostgreSQL
                                      → AI Service (/embed) → ChromaDB
```

- Fetches resolved issues via JQL
- Parses ADF descriptions, comments, changelog
- Stores structured ticket data + comments
- Generates embeddings for each ticket document

### 2. New Ticket Analysis
```
User opens ticket → Backend → AI analyze + embed
                           → Vector search (similar)
                           → GPT recommendation
                           → Store ai_recommendations
```

### 3. RAG Chat

```
User message → Backend chat.service
            → AI Service ragChat()
            → ChromaDB similarity retrieval (top 5)
            → GPT with grounded context
            → Response + source citations
```

### 4. GitHub Code Security Scan

```
Admin triggers scan → Backend (github.service)
                   → GitHub REST API (repo tree + file contents)
                   → AI Service (/security/review-code)
                   → LLM security review (OWASP-focused)
                   → PostgreSQL (security_scan_runs, security_findings)
```

- Fetches up to 25 priority source files per repo/branch (PAT auth)
- Batches files to the AI service for structured vulnerability findings
- Standalone vertical — no Jira correlation in MVP
- Results surfaced in `/security` dashboard and scan detail pages

## Component Diagram

```mermaid
flowchart TB
    subgraph Client
        FE[React Frontend]
    end

    subgraph API
        BE[Express Backend]
    end

    subgraph AI
        AIS[AI Service]
        OAI[OpenAI API]
        CHR[ChromaDB]
    end

    subgraph Data
        PG[(PostgreSQL)]
        RD[(Redis)]
    end

    JIRA[Jira Cloud API]
    GH[GitHub REST API]

    FE --> BE
    BE --> PG
    BE --> RD
    BE --> AIS
    BE --> JIRA
    BE --> GH
    AIS --> OAI
    AIS --> CHR
```

## Security

- JWT authentication on all `/api/*` routes except `/auth/login` and `/auth/register`
- Jira and GitHub tokens stored in DB (MVP: plain text; production: encrypt with KMS)
- Admin-only routes: Jira config, sync; GitHub config, security scans
- CORS restricted to frontend origin
- AI security findings are advisory — not a substitute for certified SAST

## Scalability Path

| MVP | Production |
|-----|------------|
| Single backend instance | Horizontal scaling behind load balancer |
| ChromaDB single node | Pinecone or managed vector DB |
| Sync on-demand | Webhook from Jira + queue (BullMQ) |
| Redis optional cache | Required for session + rate limits |

## API Gateway Pattern

All frontend calls go to `/api/*` on the backend. The backend proxies AI operations to the AI service — keeping OpenAI keys off the client and allowing independent scaling of the AI layer.
