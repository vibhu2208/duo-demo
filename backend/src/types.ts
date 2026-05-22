export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface JiraTicket {
  id: string;
  jira_key: string;
  jira_id: string;
  title: string;
  description: string | null;
  issue_type: string | null;
  affected_module: string | null;
  error_keywords: string[] | null;
  severity: string | null;
  category: string | null;
  labels: string[] | null;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  status: string;
  resolution: string | null;
  resolution_notes: string | null;
  root_cause: string | null;
  final_fix: string | null;
  resolution_time_hours: number | null;
  created_at_jira: Date | null;
  resolved_at_jira: Date | null;
  embedding_synced: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author: string | null;
  body: string;
  created_at_jira: Date | null;
}

export interface AiRecommendation {
  id: string;
  ticket_id: string;
  probable_root_cause: string | null;
  recommended_steps: string[] | null;
  likely_resolution: string | null;
  investigation_checklist: string[] | null;
  possible_fixes: string[] | null;
  confidence_score: number | null;
  similar_ticket_ids: string[] | null;
  model_used: string | null;
  created_at: Date;
}

export interface SimilarTicket {
  ticket: JiraTicket;
  similarity_score: number;
  resolution_summary: string | null;
}
