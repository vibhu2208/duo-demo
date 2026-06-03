import axios from 'axios';

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE']);

export function isRetryableNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code && RETRYABLE_CODES.has(err.code)) return true;
  return err.message.toLowerCase().includes('econnreset');
}

export function formatAiServiceError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as { error?: string } | undefined;
    if (body?.error) return body.error;

    const code = err.code || '';
    if (code === 'ECONNRESET' || err.message.toLowerCase().includes('econnreset')) {
      return (
        'AI service connection was reset (ECONNRESET). On Render free tier the service may be waking up — wait 30s and retry. ' +
        'Verify AI_SERVICE_URL points to your deployed ai-service.'
      );
    }
    if (code === 'ECONNREFUSED') {
      return 'Cannot reach AI service. Start it locally: cd ai-service && npm run dev — or check AI_SERVICE_URL on Render.';
    }
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return 'AI service timed out. GitLab Duo can take up to 60s — try again or use a shorter question.';
    }
  }
  return err instanceof Error ? err.message : 'AI service request failed';
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableNetworkError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }

  throw lastErr;
}
