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
async function graphql(query, variables) {
    const { data, status } = await withRetry(() => axios.post(`${config.gitlabUrl}/api/graphql`, { query, variables }, {
        headers: gitlabHeaders(),
        timeout: 90000,
        validateStatus: () => true,
    }), { label: 'gitlab-graphql', attempts: 2, delayMs: 1500 });
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
export async function getCurrentUserGid() {
    const { data } = await axios.get(`${config.gitlabUrl}/api/v4/user`, {
        headers: gitlabHeaders(),
        timeout: 15000,
    });
    return `gid://gitlab/User/${data.id}`;
}
/**
 * GitLab.com: GraphQL aiAction + poll by requestId only (never stale global messages).
 */
export async function gitlabChatViaGraphql(fullPrompt, userQuestion, opts) {
    const userGid = await getCurrentUserGid();
    const clientSubscriptionId = randomUUID();
    const mutation = `
    mutation AiChat($input: AiActionInput!) {
      aiAction(input: $input) {
        requestId
        threadId
        errors
      }
    }
  `;
    const actionData = await graphql(mutation, {
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
    const maxAttempts = opts?.maxAttempts ?? 40;
    const delayMs = 1500;
    for (let i = 0; i < maxAttempts; i++) {
        await sleep(delayMs);
        const answer = await fetchMessageByRequestId(requestId, action.threadId);
        if (answer &&
            isPlausibleReply(answer, userQuestion, {
                securityMode: opts?.securityMode,
                pollAttempt: i,
            })) {
            return answer;
        }
    }
    throw new Error('GitLab Duo did not return a response in time. The request may be too large — retry with a smaller repo or fewer files.');
}
async function fetchMessageByRequestId(requestId, threadId) {
    if (threadId) {
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
            const data = await graphql(query, { threadId });
            const match = data.aiMessages.nodes.find((m) => m.requestId === requestId && isAssistantRole(m.role) && m.content?.trim());
            if (match)
                return match.content;
        }
        catch {
            /* fall through */
        }
    }
    const data = await graphql(`
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
    const match = data.aiMessages?.nodes?.find((m) => m.requestId === requestId && isAssistantRole(m.role) && m.content?.trim());
    return match?.content || null;
}
function isAssistantRole(role) {
    const r = role?.toLowerCase() || '';
    return r === 'assistant' || r === 'model' || r === 'bot';
}
/** Reject stale/wrong cached Duo messages (e.g. old JSON analysis for a "Hey") */
function isPlausibleReply(content, userQuestion, opts) {
    const c = content.trim();
    if (!c)
        return false;
    if (/i'?m sorry|can'?t generate|cannot generate|unable to (assist|help|respond)/i.test(c)) {
        return false;
    }
    const isSecurityTask = opts?.securityMode === true || userQuestion.startsWith('security-review:');
    if (isSecurityTask) {
        if (c.includes('{') && c.includes('}'))
            return true;
        // Duo often streams prose first — accept substantive reply after ~40s of polling
        if ((opts?.pollAttempt ?? 0) >= 25 && c.length > 60)
            return true;
        return false;
    }
    const isJsonAnalysis = c.startsWith('{') && c.includes('probableRootCause');
    const isSecurityJson = c.includes('"findings"') || (c.startsWith('{') && c.includes('findings'));
    const shortGreeting = /^(hi|hey|hello|ok|yes|no)[\s!.?]*$/i.test(userQuestion.trim());
    if (shortGreeting && isJsonAnalysis)
        return false;
    if (shortGreeting && c.length > 800 && !isSecurityJson)
        return false;
    return true;
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
