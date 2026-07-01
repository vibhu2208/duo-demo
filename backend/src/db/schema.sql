-- Jira Ticket Intelligence - PostgreSQL Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jira_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  base_url VARCHAR(500) NOT NULL,
  email VARCHAR(255) NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  project_key VARCHAR(50),
  deployment_type VARCHAR(20) DEFAULT 'server' CHECK (deployment_type IN ('cloud', 'server')),
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(50) DEFAULT 'idle',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jira_config ADD COLUMN IF NOT EXISTS deployment_type VARCHAR(20) DEFAULT 'server';
ALTER TABLE jira_config ADD COLUMN IF NOT EXISTS sync_filter VARCHAR(20) DEFAULT 'resolved';
ALTER TABLE jira_config ADD COLUMN IF NOT EXISTS insecure_ssl BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS jira_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  jira_key VARCHAR(50) UNIQUE NOT NULL,
  jira_id VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  issue_type VARCHAR(100),
  affected_module VARCHAR(255),
  error_keywords TEXT[],
  severity VARCHAR(50),
  category VARCHAR(100),
  labels TEXT[],
  priority VARCHAR(50),
  assignee VARCHAR(255),
  reporter VARCHAR(255),
  status VARCHAR(100) NOT NULL,
  resolution VARCHAR(255),
  resolution_notes TEXT,
  root_cause TEXT,
  final_fix TEXT,
  resolution_time_hours DECIMAL(10, 2),
  created_at_jira TIMESTAMPTZ,
  resolved_at_jira TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  embedding_synced BOOLEAN DEFAULT FALSE,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jira_tickets_status ON jira_tickets(status);
CREATE INDEX IF NOT EXISTS idx_jira_tickets_jira_key ON jira_tickets(jira_key);
CREATE INDEX IF NOT EXISTS idx_jira_tickets_resolved ON jira_tickets(resolved_at_jira);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  jira_comment_id VARCHAR(50),
  author VARCHAR(255),
  body TEXT NOT NULL,
  created_at_jira TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  from_status VARCHAR(100),
  to_status VARCHAR(100) NOT NULL,
  changed_at TIMESTAMPTZ,
  changed_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID UNIQUE NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  chroma_id VARCHAR(255),
  embedding_model VARCHAR(100),
  content_hash VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_ticket_id UUID NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  related_ticket_id UUID NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  similarity_score DECIMAL(5, 4) NOT NULL,
  relationship_type VARCHAR(50) DEFAULT 'similar',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_ticket_id, related_ticket_id)
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES jira_tickets(id) ON DELETE CASCADE,
  probable_root_cause TEXT,
  recommended_steps JSONB,
  likely_resolution TEXT,
  investigation_checklist JSONB,
  possible_fixes JSONB,
  confidence_score DECIMAL(5, 4),
  similar_ticket_ids UUID[],
  model_used VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_ticket ON ai_recommendations(ticket_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES jira_tickets(id) ON DELETE SET NULL,
  title VARCHAR(255) DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  tickets_fetched INT DEFAULT 0,
  tickets_created INT DEFAULT 0,
  tickets_updated INT DEFAULT 0,
  embeddings_indexed INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'running',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  ticket_id UUID REFERENCES jira_tickets(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);

-- GitHub Code Security vertical

CREATE TABLE IF NOT EXISTS github_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_encrypted TEXT NOT NULL,
  default_owner VARCHAR(255),
  last_scan_at TIMESTAMPTZ,
  scan_status VARCHAR(50) DEFAULT 'idle',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_scan_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  repo_full_name VARCHAR(500) NOT NULL,
  branch VARCHAR(255) NOT NULL DEFAULT 'main',
  commit_sha VARCHAR(64),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  files_scanned INT DEFAULT 0,
  findings_count INT DEFAULT 0,
  severity_summary JSONB DEFAULT '{}',
  summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_scan_runs_repo ON security_scan_runs(repo_full_name, created_at DESC);

CREATE TABLE IF NOT EXISTS security_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scan_run_id UUID NOT NULL REFERENCES security_scan_runs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  line_start INT,
  line_end INT,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  category VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  recommendation TEXT,
  code_snippet TEXT,
  confidence DECIMAL(5, 4),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_findings_scan ON security_findings(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_security_findings_severity ON security_findings(scan_run_id, severity);
