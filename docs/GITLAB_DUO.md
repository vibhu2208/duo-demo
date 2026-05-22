# GitLab Duo AI Integration

The **ai-service** handles all LLM and embedding work. It supports three providers via `AI_PROVIDER` in `.env`.

## How it works

```
User message (frontend)
    → Backend /api/chat/query
    → AI Service /chat
        1. Vector search (similar Jira tickets)
        2. Build RAG context from top matches
        3. Call LLM provider (GitLab Duo / OpenAI / Mock)
    → Response + source citations
```

### GitLab Duo flow

When `AI_PROVIDER=gitlab`:

1. Similar tickets are retrieved from the vector store (Chroma or in-memory).
2. Context is bundled into the prompt.
3. **GitLab.com:** uses GraphQL `aiAction` mutation (REST `/chat/completions` returns 404 on gitlab.com).
4. **Self-managed:** tries REST first, falls back to GraphQL on 404.
5. Response is polled from `aiMessages` and returned to the app.

**API docs:** https://docs.gitlab.com/api/chat/

### Required environment variables

```env
AI_PROVIDER=gitlab
GITLAB_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-personal-access-token
GITLAB_PROJECT_ID=12345   # optional but recommended
```

**Token scopes:** `api` (and Duo access per your GitLab plan).

**Self-managed:** Enable feature flag `access_rest_chat` on your instance.

### Embeddings (vector search)

GitLab Duo does not expose a public embeddings API. For MVP:

| `EMBEDDING_PROVIDER` | Behavior |
|---------------------|----------|
| `local` (default) | Free hash-based vectors — good for demo/testing |
| `openai` | Uses `OPENAI_API_KEY` + `text-embedding-3-small` |

ChromaDB is optional. If Chroma is down, vectors are stored **in-memory** automatically.

## Provider comparison

| Provider | Use case | Keys needed |
|----------|----------|-------------|
| `mock` | Local demo, no API | None |
| `gitlab` | Production with Duo | `GITLAB_URL`, `GITLAB_TOKEN` |
| `openai` | OpenAI GPT + embeddings | `OPENAI_API_KEY` |

## File map (ai-service)

```
ai-service/src/
├── lib/
│   ├── llm/
│   │   ├── index.ts       # Routes to active provider
│   │   ├── gitlab-duo.ts  # GitLab Chat Completions API
│   │   ├── openai-llm.ts  # OpenAI chat fallback
│   │   └── mock-llm.ts    # Demo responses from RAG context
│   ├── embeddings.ts      # local + OpenAI embeddings
│   ├── vector-store.ts    # In-memory fallback index
│   └── chroma.ts          # ChromaDB with memory fallback
└── services/
    └── rag.service.ts     # analyze, recommend, chat, embed
```

## Testing without GitLab

```powershell
# .env
AI_PROVIDER=mock
EMBEDDING_PROVIDER=local
USE_CHROMA=false

# Terminal 1
cd ai-service
npm run dev

# Terminal 2
cd backend
npm run seed:demo

# Terminal 3
cd frontend
npm run dev
```

Then open **AI Assistant** and try: *"Have we seen this before?"* or *"What is the root cause?"*

## Switching to GitLab Duo

1. Set `AI_PROVIDER=gitlab` in `.env`
2. Add `GITLAB_URL` and `GITLAB_TOKEN`
3. Restart **ai-service**
4. Run `npm run seed:demo` to index tickets
5. Chat — responses come from Duo with Jira context in `additional_context`
