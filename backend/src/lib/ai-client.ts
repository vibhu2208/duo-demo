import axios from 'axios';
import { config } from '../config.js';
import { formatAiServiceError, withRetry } from './network-utils.js';

const client = axios.create({
  baseURL: config.aiServiceUrl,
  timeout: 120000,
});

export interface EmbeddingResult {
  ticketId: string;
  chromaId: string;
  success: boolean;
}

export interface SimilarSearchResult {
  ticketId: string;
  jiraKey: string;
  similarityScore: number;
  summary: string;
  resolutionSummary: string;
}

export interface AnalyzeResult {
  issueType: string;
  affectedModule: string;
  errorKeywords: string[];
  severity: string;
  category: string;
  embedding: number[];
}

export interface RecommendationResult {
  probableRootCause: string;
  recommendedSteps: string[];
  likelyResolution: string;
  investigationChecklist: string[];
  possibleFixes: string[];
  confidenceScore: number;
}

export interface ChatResult {
  answer: string;
  sources: { jiraKey: string; title: string; similarityScore: number }[];
  sessionId?: string;
}

export interface CodeReviewFinding {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation: string;
  codeSnippet?: string;
  confidence?: number;
}

export interface CodeReviewResult {
  findings: CodeReviewFinding[];
  summary: string;
}

type EmbedPayload = {
  ticketId: string;
  jiraKey: string;
  title: string;
  description: string;
  comments: string[];
  resolution: string;
  labels: string[];
};

export const aiClient: {
  health: () => Promise<unknown>;
  embedTicket: (payload: EmbedPayload) => Promise<{ success: boolean; chromaId: string }>;
  searchSimilar: (payload: {
    ticketId?: string;
    queryText: string;
    topK?: number;
    resolvedOnly?: boolean;
  }) => Promise<SimilarSearchResult[]>;
  analyzeTicket: (payload: { title: string; description: string; comments?: string[] }) => Promise<AnalyzeResult>;
  generateRecommendation: (payload: {
    ticketId: string;
    title: string;
    description: string;
    similarTickets: SimilarSearchResult[];
  }) => Promise<RecommendationResult>;
  chat: (payload: {
    message: string;
    ticketId?: string;
    ticketContext?: string;
    dbContext?: string;
    dbStats?: { totalTickets: number; ticketsInPrompt: number };
    history?: { role: string; content: string }[];
  }) => Promise<ChatResult>;
  bulkEmbed: (tickets: EmbedPayload[]) => Promise<{ indexed: number; failed: number }>;
  reviewCode: (payload: {
    files: { path: string; language: string; content: string }[];
    repo: string;
    branch: string;
  }) => Promise<CodeReviewResult>;
} = {
  async health() {
    const { data } = await client.get('/health');
    return data;
  },

  async embedTicket(payload: {
    ticketId: string;
    jiraKey: string;
    title: string;
    description: string;
    comments: string[];
    resolution: string;
    labels: string[];
  }) {
    const { data } = await client.post<{ success: boolean; chromaId: string }>('/embed', payload);
    return data;
  },

  async searchSimilar(payload: {
    ticketId?: string;
    queryText: string;
    topK?: number;
    resolvedOnly?: boolean;
  }) {
    const { data } = await client.post<{ results: SimilarSearchResult[] }>('/search/similar', payload);
    return data.results;
  },

  async analyzeTicket(payload: { title: string; description: string; comments?: string[] }) {
    const { data } = await client.post<AnalyzeResult>('/analyze', payload);
    return data;
  },

  async generateRecommendation(payload: {
    ticketId: string;
    title: string;
    description: string;
    similarTickets: SimilarSearchResult[];
  }) {
    const { data } = await client.post<RecommendationResult>('/recommend', payload);
    return data;
  },

  async chat(payload: {
    message: string;
    ticketId?: string;
    ticketContext?: string;
    dbContext?: string;
    dbStats?: { totalTickets: number; ticketsInPrompt: number };
    history?: { role: string; content: string }[];
  }) {
    try {
      return await withRetry(
        () => client.post<ChatResult>('/chat', payload).then((r) => r.data),
        { attempts: 3, delayMs: 2000 }
      );
    } catch (err: unknown) {
      throw new Error(formatAiServiceError(err));
    }
  },

  async bulkEmbed(tickets: EmbedPayload[]) {
    const { data } = await client.post<{ indexed: number; failed: number }>('/embed/bulk', { tickets });
    return data;
  },

  async reviewCode(payload: {
    files: { path: string; language: string; content: string }[];
    repo: string;
    branch: string;
  }) {
    try {
      return await withRetry(
        () => client.post<CodeReviewResult>('/security/review-code', payload).then((r) => r.data),
        { attempts: 2, delayMs: 2000 }
      );
    } catch (err: unknown) {
      throw new Error(formatAiServiceError(err));
    }
  },
};
