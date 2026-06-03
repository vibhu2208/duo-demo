import axios, { AxiosError } from 'axios';
import { config, getGitlabSetupStatusAsync } from '../../config.js';
import { formatNetworkError, withRetry } from '../network-utils.js';
import { gitlabChatViaGraphql } from './gitlab-graphql.js';
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
    const ax = err as AxiosError<{ message?: string; error?: string }>;
    const status = ax.response?.status;
    const body = ax.response?.data;
    const msg = body?.message || body?.error || ax.message;

    if (status === 401) {
      return (
        'GitLab returned 401 Unauthorized. Regenerate GITLAB_TOKEN with "api" scope at ' +
        'https://gitlab.com/-/user_settings/personal_access_tokens'
      );
    }
    if (status === 403) {
      return `GitLab returned 403 Forbidden. Duo may not be enabled on your subscription. ${msg}`;
    }
    if (status) return `GitLab API error (${status}): ${msg}`;
    if (ax.code === 'ECONNABORTED') return 'GitLab API timed out.';
    if (ax.code === 'ECONNRESET' || ax.message.toLowerCase().includes('econnreset')) {
      return (
        'GitLab closed the connection (ECONNRESET). Retry in a few seconds. ' +
        'If you use on-prem GitLab, ensure VPN is connected and GITLAB_URL is reachable from this host.'
      );
    }
  }
  return formatNetworkError(err, 'GitLab Duo');
}

/** Verify PAT works */
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

function buildFullPrompt(
  systemPrompt: string,
  userPrompt: string,
  history: ChatMessage[],
  additionalContext: ChatContextItem[]
): string {
  const contextBlock = additionalContext
    .map((c, i) => `[Context ${i + 1} — ${c.id}]\n${c.content}`)
    .join('\n\n');

  const historyBlock =
    history.length > 0
      ? `\n\nConversation:\n${history.map((h) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

  return [
    systemPrompt,
    contextBlock ? `\n\nHistorical Jira ticket context:\n${contextBlock}` : '',
    historyBlock,
    `\n\nUser question:\n${userPrompt}`,
  ].join('');
}

/**
 * GitLab Duo — REST chat/completions returns 404 on GitLab.com.
 * Uses GraphQL aiAction (official path for external apps with PAT).
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

  const setup = await getGitlabSetupStatusAsync();
  if (!setup.ready) {
    throw new Error(setup.tokenError || 'GitLab Duo is not configured');
  }

  const fullContent = buildFullPrompt(systemPrompt, userPrompt, history, additionalContext);

  // GitLab.com: REST endpoint not available (404) — use GraphQL
  const useGraphql =
    config.gitlabUrl.includes('gitlab.com') ||
    process.env.GITLAB_USE_GRAPHQL === 'true';

  if (useGraphql) {
    try {
      return await gitlabChatViaGraphql(fullContent, userPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GraphQL chat failed';
      throw new Error(`GitLab Duo (GraphQL): ${msg}`);
    }
  }

  // Self-managed: try REST first, then GraphQL on 404
  const url = `${config.gitlabUrl}/api/v4/chat/completions`;
  const contextPayload = additionalContext.slice(0, 10).map((c) => ({
    category: c.category,
    id: String(c.id).slice(0, 255),
    content: c.content.slice(0, 8000),
    metadata: c.metadata || {},
  }));

  try {
    const { data, status } = await withRetry(
      () =>
        axios.post<string | Record<string, unknown>>(
          url,
          {
            content: fullContent,
            with_clean_history: true,
            ...(config.gitlabProjectId ? { project_id: config.gitlabProjectId } : {}),
            ...(contextPayload.length > 0 ? { additional_context: contextPayload } : {}),
          },
          { headers: gitlabHeaders(), timeout: 90000, validateStatus: () => true }
        ),
      { label: 'gitlab-rest-chat', attempts: 2, delayMs: 2000 }
    );

    if (status === 404) {
      return await gitlabChatViaGraphql(fullContent, userPrompt);
    }

    if (status >= 400) {
      const msg =
        typeof data === 'object' && data !== null
          ? String((data as Record<string, unknown>).message || JSON.stringify(data))
          : String(data);
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
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return await gitlabChatViaGraphql(fullContent, userPrompt);
    }
    throw new Error(formatGitlabError(err));
  }
}
