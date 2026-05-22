import { config } from '../../config.js';
import { gitlabChatCompletion } from './gitlab-duo.js';
import { openaiChatCompletion } from './openai-llm.js';
import { mockChatCompletion } from './mock-llm.js';

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type ChatContextItem = {
  category: 'issue' | 'file' | 'snippet';
  id: string;
  content: string;
  metadata?: Record<string, string>;
};

async function assertProviderReady() {
  const { getAiSetupStatus } = await import('../../config.js');
  const status = await getAiSetupStatus();
  if (!status.ready) {
    throw new Error(status.message);
  }
}

/**
 * All LLM calls go to the configured provider — no silent fallback to hardcoded mock.
 * Mock is ONLY used when AI_PROVIDER=mock is explicitly set in .env.
 */
export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  history: ChatMessage[] = [],
  additionalContext?: ChatContextItem[]
): Promise<string> {
  if (config.provider === 'mock') {
    return mockChatCompletion(systemPrompt, userPrompt, history, additionalContext);
  }

  if (config.provider === 'gitlab') {
    await assertProviderReady();
    return gitlabChatCompletion(systemPrompt, userPrompt, history, additionalContext);
  }

  if (config.provider === 'openai') {
    await assertProviderReady();
    return openaiChatCompletion(systemPrompt, userPrompt, history);
  }

  throw new Error(`Unknown AI_PROVIDER: ${config.provider}`);
}

export async function getActiveProviderLabel(): Promise<string> {
  const { getAiSetupStatus } = await import('../../config.js');
  const status = await getAiSetupStatus();
  if (config.provider === 'gitlab') return status.ready ? 'GitLab Duo' : 'GitLab Duo (not ready)';
  if (config.provider === 'openai') return status.ready ? 'OpenAI' : 'OpenAI (not configured)';
  if (config.provider === 'mock') return 'Mock (explicit demo only)';
  return config.provider;
}
