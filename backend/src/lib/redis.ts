import { config } from '../config.js';

interface RedisLike {
  get(key: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<void>;
  connect(): Promise<void>;
  on(event: string, handler: () => void): void;
}

let redis: RedisLike | null = null;
let initPromise: Promise<RedisLike | null> | null = null;

async function initRedis(): Promise<RedisLike | null> {
  if (redis) return redis;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mod = await import('ioredis');
      const Redis = mod.default as unknown as new (
        url: string,
        opts?: { maxRetriesPerRequest?: number; lazyConnect?: boolean }
      ) => RedisLike;
      const client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      client.on('error', () => {});
      redis = client;
      return client;
    } catch {
      return null;
    }
  })();

  return initPromise;
}

export async function cacheGet(key: string): Promise<string | null> {
  const r = await initRedis();
  if (!r) return null;
  try {
    await r.connect().catch(() => {});
    return r.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  const r = await initRedis();
  if (!r) return;
  try {
    await r.setex(key, ttlSeconds, value);
  } catch {
    /* optional cache */
  }
}
