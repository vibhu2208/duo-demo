import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export type AiProvider = 'gitlab' | 'openai' | 'mock';

function resolveProvider(): AiProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === 'mock' || explicit === 'openai' || explicit === 'gitlab') {
    return explicit;
  }
  // Auto-detect: prefer GitLab Duo when credentials exist
  const gitlabToken = process.env.GITLAB_TOKEN || process.env.GITLAB_ACCESS_TOKEN || '';
  const gitlabUrl = (process.env.GITLAB_URL || '').replace(/\/$/, '');
  if (gitlabUrl && gitlabToken) return 'gitlab';
  if (process.env.OPENAI_API_KEY?.startsWith('sk-')) return 'openai';
  return 'gitlab'; // default intent — will fail at runtime with clear error if not configured
}

export const config = {
  port: parseInt(process.env.PORT || process.env.AI_SERVICE_PORT || '3002', 10),
  provider: resolveProvider(),

  gitlabUrl: (process.env.GITLAB_URL || '').replace(/\/$/, ''),
  gitlabToken: process.env.GITLAB_TOKEN || process.env.GITLAB_ACCESS_TOKEN || '',
  gitlabProjectId: process.env.GITLAB_PROJECT_ID
    ? parseInt(process.env.GITLAB_PROJECT_ID, 10)
    : undefined,

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'local',

  chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
  chromaCollection: process.env.CHROMA_COLLECTION || 'jira_tickets',
  useChroma: process.env.USE_CHROMA !== 'false',
};

export function getGitlabSetupStatus() {
  const missing: string[] = [];
  if (!config.gitlabUrl) missing.push('GITLAB_URL');
  if (!config.gitlabToken) missing.push('GITLAB_TOKEN');
  return {
    configured: config.gitlabUrl.length > 0 && config.gitlabToken.length > 0,
    ready: false, // set true after async token validation
    missing,
    url: config.gitlabUrl || null,
    hasProjectId: !!config.gitlabProjectId,
    tokenValid: false as boolean,
    username: null as string | null,
    tokenError: null as string | null,
  };
}

let cachedTokenValidation: {
  at: number;
  ok: boolean;
  message: string;
  username?: string;
} | null = null;

export async function getGitlabSetupStatusAsync() {
  const base = getGitlabSetupStatus();
  if (!base.configured) {
    return { ...base, ready: false, tokenError: `Missing: ${base.missing.join(', ')}` };
  }

  const now = Date.now();
  if (cachedTokenValidation && now - cachedTokenValidation.at < 60_000) {
    return {
      ...base,
      ready: cachedTokenValidation.ok && config.provider === 'gitlab',
      tokenValid: cachedTokenValidation.ok,
      username: cachedTokenValidation.username || null,
      tokenError: cachedTokenValidation.ok ? null : cachedTokenValidation.message,
    };
  }

  const { validateGitlabToken } = await import('./lib/llm/gitlab-duo.js');
  const result = await validateGitlabToken();
  cachedTokenValidation = { at: now, ...result };

  return {
    ...base,
    ready: result.ok && config.provider === 'gitlab',
    tokenValid: result.ok,
    username: result.username || null,
    tokenError: result.ok ? null : result.message,
  };
}

export async function getAiSetupStatus() {
  const gitlab = await getGitlabSetupStatusAsync();

  if (config.provider === 'mock') {
    return {
      provider: 'mock' as const,
      ready: true,
      message: 'Mock mode enabled (AI_PROVIDER=mock). Responses are template-based, not from GitLab Duo.',
      gitlab,
    };
  }

  if (config.provider === 'gitlab') {
    const usesGraphql = config.gitlabUrl.includes('gitlab.com');
    return {
      provider: 'gitlab' as const,
      ready: gitlab.ready,
      message: gitlab.ready
        ? `GitLab Duo ready (${gitlab.username}) via ${usesGraphql ? 'GraphQL' : 'REST'}`
        : gitlab.tokenError || `GitLab Duo NOT configured. Add to .env: ${gitlab.missing.join(', ')}`,
      gitlab: { ...gitlab, chatMode: usesGraphql ? 'graphql' : 'rest' },
    };
  }

  if (config.provider === 'openai') {
    const ready = !!config.openaiApiKey && config.openaiApiKey.startsWith('sk-');
    return {
      provider: 'openai' as const,
      ready,
      message: ready ? 'OpenAI is configured.' : 'OpenAI NOT configured. Set OPENAI_API_KEY in .env.',
      gitlab,
    };
  }

  return { provider: config.provider, ready: false, message: 'Unknown provider', gitlab };
}
