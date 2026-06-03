import axios from 'axios';

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'ENOTFOUND',
]);

export function isRetryableNetworkError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code && RETRYABLE_CODES.has(err.code)) return true;
  const msg = err.message.toLowerCase();
  return msg.includes('econnreset') || msg.includes('socket hang up');
}

export function formatNetworkError(err: unknown, service: string): string {
  if (axios.isAxiosError(err)) {
    const code = err.code || '';
    if (code === 'ECONNRESET' || err.message.toLowerCase().includes('econnreset')) {
      return `${service} closed the connection (ECONNRESET). This is often temporary — try again in a few seconds. If it persists, check VPN/firewall access to GitLab or that the AI service is running.`;
    }
    if (code === 'ECONNREFUSED') {
      return `Cannot reach ${service} (connection refused). Ensure ai-service is running and AI_SERVICE_URL is correct.`;
    }
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      return `${service} timed out. The request may be too slow — try a shorter question or increase proxy timeouts.`;
    }
    if (err.response?.status) {
      return `${service} error (${err.response.status})`;
    }
  }
  return err instanceof Error ? err.message : `${service} request failed`;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1500;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableNetworkError(err) || i === attempts - 1) throw err;
      console.warn(`[${opts.label || 'network'}] retry ${i + 1}/${attempts - 1} after ${err instanceof Error ? err.message : err}`);
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }

  throw lastErr;
}
