# Jira Ticket Intelligence & Resolution Assistant

AI-powered MVP that analyzes historical Jira tickets and helps resolve new issues faster via similarity search, RAG recommendations, and a chat assistant.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   Frontend  │────▶│   Backend   │────▶│  PostgreSQL  │
│  (React)    │     │  (Express)  │     └──────────────┘
└─────────────┘     │      │      │     ┌──────────────┐
                    │      ├────▶│    Redis (cache) │
                    │      │      │     └──────────────┘
                    │      ▼      │
                    │  AI Service │────▶ ChromaDB (vectors)
                    └─────────────┘     OpenAI API
                           │
                           ▼
                    Jira REST API
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Jira Cloud account + API token
- OpenAI API key

### 1. Environment

```bash
cp .env.example .env
# Edit .env with your keys
```

### 2. Docker (recommended)

```bash
cd docker
docker compose up -d
```

Services: Postgres (5432), Redis (6379), Chroma (8000), backend (3001), ai-service (3002).

### 3. Local development

```bash
# Install all
npm run install:all

# Run DB migrations
cd backend && npm run migrate

# Terminal 1 - AI service
cd ai-service && npm run dev

# Terminal 2 - Backend
cd backend && npm run dev

# Terminal 3 - Frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- AI Service: http://localhost:3002

### Default login (seed)

- Email: `admin@example.com`
- Password: `admin123`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/register` | Register |
| GET | `/api/auth/me` | Current user |
| POST | `/api/jira/sync` | Sync tickets from Jira |
| GET | `/api/jira/config` | Jira connection status |
| PUT | `/api/jira/config` | Save Jira credentials |
| GET | `/api/tickets` | List tickets |
| GET | `/api/tickets/:id` | Ticket detail + AI analysis |
| GET | `/api/tickets/:id/similar` | Similar tickets |
| POST | `/api/tickets/:id/analyze` | Run AI analysis |
| POST | `/api/chat/query` | RAG chat |
| GET | `/api/chat/sessions` | Chat sessions |
| GET | `/api/analytics/summary` | Dashboard analytics |

## Folder Structure

```
├── frontend/          React + TypeScript + Tailwind + ShadCN
├── backend/           Express API + Jira sync + auth
├── ai-service/        Embeddings, ChromaDB, RAG, recommendations
├── docker/            Docker Compose
└── docs/              Architecture & roadmap
```

## Demo data (no Jira required)

```bash
# Start ai-service first, then:
cd backend && npm run seed:demo
```

Creates 10 realistic tickets with comments, AI recommendations, and vector index.

## GitLab Duo AI

Set in `.env`:

```env
AI_PROVIDER=gitlab
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-xxx
```

See [docs/GITLAB_DUO.md](docs/GITLAB_DUO.md) for full integration guide.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database Schema](docs/DATABASE.md)
- [GitLab Duo Setup](docs/GITLAB_DUO.md)
- [Implementation Roadmap](docs/ROADMAP.md)

## MVP Constraints

- Jira-only integration (no GitLab/CI/CD)
- OpenAI for LLM + embeddings
- ChromaDB for vector search
- Simple JWT auth
