# Database Schema

PostgreSQL is the system of record. ChromaDB stores vector embeddings separately.

## Entity Relationship

```
users ──┬── jira_config
        ├── chat_sessions ── chat_messages
        └── analytics_events

jira_tickets ──┬── ticket_comments
               ├── ticket_status_history
               ├── ticket_embeddings (→ chroma_id)
               ├── ticket_relationships (self-ref)
               └── ai_recommendations
```

## Tables

### users
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | VARCHAR | Unique login |
| password_hash | VARCHAR | bcrypt hash |
| name | VARCHAR | Display name |
| role | VARCHAR | `admin` or `user` |

### jira_tickets
Core ticket storage synced from Jira.

| Column | Type | Description |
|--------|------|-------------|
| jira_key | VARCHAR | e.g. PROJ-123 |
| title, description | TEXT | Issue content |
| issue_type, category, severity | VARCHAR | AI-extracted metadata |
| error_keywords | TEXT[] | AI-extracted keywords |
| resolution, resolution_notes, final_fix | TEXT | Resolution data |
| resolution_time_hours | DECIMAL | Computed from created/resolved |
| embedding_synced | BOOLEAN | Vector index status |

### ticket_comments
Developer comments from Jira, used in RAG context.

### ticket_embeddings
Maps PostgreSQL ticket IDs to ChromaDB vector IDs.

### ticket_relationships
Cached similarity edges between tickets with scores.

### ai_recommendations
Stored GPT outputs per analysis run.

### chat_sessions / chat_messages
RAG chat history per user, optionally linked to a ticket.

### sync_logs
Audit trail for Jira sync operations.

### analytics_events
Tracks `ai_analysis` and `chat_query` for dashboard metrics.

## Vector Store (ChromaDB)

Collection: `jira_tickets`

Metadata per vector:
- `ticketId` (UUID)
- `jiraKey`
- `title`
- `hasResolution`

Document text = title + description + comments + resolution (preprocessed).
