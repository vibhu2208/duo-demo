import { config } from '../config.js';
let redis = null;
let initPromise = null;
async function initRedis() {
    if (redis)
        return redis;
    if (initPromise)
        return initPromise;
    initPromise = (async () => {
        try {
            const mod = await import('ioredis');
            const Redis = mod.default;
            const client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
            client.on('error', () => { });
            redis = client;
            return client;
        }
        catch {
            return null;
        }
    })();
    return initPromise;
}
export async function cacheGet(key) {
    const r = await initRedis();
    if (!r)
        return null;
    try {
        await r.connect().catch(() => { });
        return r.get(key);
    }
    catch {
        return null;
    }
}
export async function cacheSet(key, value, ttlSeconds = 300) {
    const r = await initRedis();
    if (!r)
        return;
    try {
        await r.setex(key, ttlSeconds, value);
    }
    catch {
        /* optional cache */
    }
}
