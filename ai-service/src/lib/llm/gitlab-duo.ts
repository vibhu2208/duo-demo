import axios, { AxiosError } from 'axios';
import { config } from '../../config.js';
import type { ChatContextItem, ChatMessage } from './index.js';

function gitlabHeaders() {
  return {
    'PRIVATE-TOKEN': config.gitlabToken,
    Authorization: `Bearer ${config.gitlabToken}`,
    'Content-Type': 'application/json',
  };
}

function formatGitlabError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<{ message?: string; error?: string; error_description?: string }>;
    const status = ax.response?.status;
    const body = ax.response?.data;
    const msg = body?.message || body?.error || body?.error_description || ax.message;

    if (status === 401) {
      return (
        'GitLab returned 401 Unauthorized. Your GITLAB_TOKEN is invalid, expired, or missing the "api" scope. ' +
        'Create a new token at https://gitlab.com/-/user_settings/personal_access_tokens and update .env, then restart ai-service.'
      );
    }
    if (status === 403) {
      return (
        'GitLab returned 403 Forbidden. The Chat Completions REST API may not be enabled for your account. ' +
        'On GitLab.com it is often internal-only; on self-managed enable the access_rest_chat feature flag. ' +
        `Details: ${msg}`
      );
    }
    if (status === 404) {
      return `GitLab Chat API not found (404). Check GITLAB_URL is correct: ${config.gitlabUrl}`;
    }
    if (status) return `GitLab API error (${status}): ${msg}`;
    if (ax.code === 'ECONNABORTED') return 'GitLab API timed out. Try again or check network.';
  }
  return err instanceof Error ? err.message : 'GitLab Duo request failed';
}

/** Verify PAT works before chat calls */
export async function validateGitlabToken(): Promise<{ ok: boolean; message: string; username?: string }> {
  if (!config.gitlabUrl || !config.gitlabToken) {
    return { ok: false, message: 'GITLAB_URL and GITLAB_TOKEN required in .env' };
  }

  try {
    const { data, status } = await axios.get<{ username?: string; message?: string }>(
      `${config.gitlabUrl}/api/v4/user`,
      { headers: gitlabHeaders(), timeout: 15000, validateStatus: () => true }
    );

    if (status === 200 && data.username) {
      return { ok: true, message: `Authenticated as ${data.username}`, username: data.username };
    }
    return {
      ok: false,
      message: `Token rejected (${status}): ${data.message || 'Unauthorized'}. Regenerate PAT with "api" scope.`,
    };
  } catch (err) {
    return { ok: false, message: formatGitlabError(err) };
  }
}

/**
 * GitLab Duo Chat Completions API
 * POST {GITLAB_URL}/api/v4/chat/completions
 */
export async function gitlabChatCompletion(
  systemPrompt: string,
  userPrompt: string,
  history: ChatMessage[] = [],
  additionalContext: ChatContextItem[] = []
): Promise<string> {
  if (!config.gitlabUrl || !config.gitlabToken) {
    throw new Error('GitLab Duo requires GITLAB_URL and GITLAB_TOKEN in .env');
  }

  const tokenCheck = await validateGitlabToken();
  if (!tokenCheck.ok) {
    throw new Error(tokenCheck.message);
  }

  const historyBlock =
    history.length > 0
      ? `\n\nConversation history:\n${history.map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

  const fullContent = [
    '=== System instructions ===',
    systemPrompt,
    historyBlock,
    '=== User question ===',
    userPrompt,
  ].join('\n');

  const contextPayload = additionalContext.slice(0, 10).map((c) => ({
    category: c.category,
    id: String(c.id).slice(0, 255),
    content: c.content.slice(0, 8000),
    metadata: c.metadata || {},
  }));

  const url = `${config.gitlabUrl}/api/v4/chat/completions`;

  try {
    const { data, status } = await axios.post<string | Record<string, unknown>>(
      url,
      {
        content: fullContent,
        with_clean_history: true,
        ...(config.gitlabProjectId ? { project_id: config.gitlabProjectId } : {}),
        ...(contextPayload.length > 0 ? { additional_context: contextPayload } : {}),
      },
      {
        headers: gitlabHeaders(),
        timeout: 60000,
        validateStatus: () => true,
      }
    );

    if (status >= 400) {
      const msg =
        typeof data === 'object' && data !== null
          ? String((data as Record<string, unknown>).message || JSON.stringify(data))
          : String(data);
      if (status === 401) {
        throw new Error(
          'GitLab returned 401 Unauthorized. Regenerate GITLAB_TOKEN with "api" scope at GitLab → Preferences → Access Tokens.'
        );
      }
      if (status === 403) {
        throw new Error(
          `GitLab returned 403 Forbidden. Chat REST API may not be available on your plan. ${msg}`
        );
      }
      throw new Error(`GitLab API error (${status}): ${msg}`);
    }

    if (typeof data === 'string') return data;
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.content === 'string') return obj.content;
      if (typeof obj.response === 'string') return obj.response;
    }

    return String(data);
  } catch (err) {
    throw new Error(formatGitlabError(err));
  }
}
