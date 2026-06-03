import axios from 'axios';
import { randomUUID } from 'crypto';
import { config } from '../../config.js';
import { withRetry } from '../network-utils.js';

function gitlabHeaders() {
  return {
    'PRIVATE-TOKEN': config.gitlabToken,
    'Content-Type': 'application/json',
  };
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const { data, status } = await withRetry(
    () =>
      axios.post<{
        data?: T;
        errors?: { message: string }[];
      }>(`${config.gitlabUrl}/api/graphql`, { query, variables }, {
        headers: gitlabHeaders(),
        timeout: 90000,
        validateStatus: () => true,
      }),
    { label: 'gitlab-graphql', attempts: 2, delayMs: 1500 }
  );

  if (status >= 400) {
    throw new Error(`GitLab GraphQL HTTP ${status}`);
  }
  if (data.errors?.length) {
    throw new Error(data.errors.map((e) => e.message).join('; '));
  }
  if (!data.data) {
    throw new Error('GitLab GraphQL returned no data');
  }
  return data.data;
}

export async function getCurrentUserGid(): Promise<string> {
  const { data } = await axios.get<{ id: number }>(`${config.gitlabUrl}/api/v4/user`, {
    headers: gitlabHeaders(),
    timeout: 15000,
  });
  return `gid://gitlab/User/${data.id}`;
}

/**
 * GitLab.com: GraphQL aiAction + poll by requestId only (never stale global messages).
 */
export async function gitlabChatViaGraphql(fullPrompt: string, userQuestion: string): Promise<string> {
  const userGid = await getCurrentUserGid();
  const clientSubscriptionId = randomUUID();

  type AiActionResult = {
    aiAction: {
      requestId: string | null;
      threadId: string | null;
      errors: string[];
    };
  };

  const mutation = `
    mutation AiChat($input: AiActionInput!) {
      aiAction(input: $input) {
        requestId
        threadId
        errors
      }
    }
  `;

  const actionData = await graphql<AiActionResult>(mutation, {
    input: {
      chat: {
        resourceId: userGid,
        content: fullPrompt,
      },
      clientSubscriptionId,
    },
  });

  const action = actionData.aiAction;
  if (action.errors?.length) {
    throw new Error(`GitLab Duo: ${action.errors.join(', ')}`);
  }

  const requestId = action.requestId;
  if (!requestId) {
    throw new Error('GitLab Duo did not return a requestId');
  }

  const maxAttempts = 25;
  const delayMs = 1500;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(delayMs);

    const answer = await fetchMessageByRequestId(requestId, action.threadId);
    if (answer && isPlausibleReply(answer, userQuestion)) {
      return answer;
    }
  }

  throw new Error(
    'GitLab Duo did not return a response in time. Try a more specific question about a Jira ticket.'
  );
}

async function fetchMessageByRequestId(
  requestId: string,
  threadId: string | null
): Promise<string | null> {
  if (threadId) {
    type ThreadMessages = {
      aiMessages: { nodes: { requestId: string; content: string; role: string }[] };
    };

    const query = `
      query ThreadMessages($threadId: AiConversationThreadID!) {
        aiMessages(threadId: $threadId) {
          nodes {
            requestId
            content
            role
          }
        }
      }
    `;

    try {
      const data = await graphql<ThreadMessages>(query, { threadId });
      const match = data.aiMessages.nodes.find(
        (m) => m.requestId === requestId && isAssistantRole(m.role) && m.content?.trim()
      );
      if (match) return match.content;
    } catch {
      /* fall through */
    }
  }

  type AllMessages = {
    aiMessages: { nodes: { requestId: string; content: string; role: string }[] };
  };

  const data = await graphql<AllMessages>(`
    query RecentAiMessages {
      aiMessages {
        nodes {
          requestId
          content
          role
        }
      }
    }
  `);

  const match = data.aiMessages?.nodes?.find(
    (m) => m.requestId === requestId && isAssistantRole(m.role) && m.content?.trim()
  );
  return match?.content || null;
}

function isAssistantRole(role: string): boolean {
  const r = role?.toLowerCase() || '';
  return r === 'assistant' || r === 'model' || r === 'bot';
}

/** Reject stale/wrong cached Duo messages (e.g. old JSON analysis for a "Hey") */
function isPlausibleReply(content: string, userQuestion: string): boolean {
  const c = content.trim();
  if (!c) return false;

  const isJsonAnalysis = c.startsWith('{') && c.includes('probableRootCause');
  const shortGreeting = /^(hi|hey|hello|ok|yes|no)[\s!.?]*$/i.test(userQuestion.trim());

  if (shortGreeting && isJsonAnalysis) return false;
  if (shortGreeting && c.length > 800) return false;

  return true;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
