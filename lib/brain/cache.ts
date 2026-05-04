import type { BrainOutput } from "@/services/brain/operating-brain";
import { getOrSet, invalidateSite, cacheKey, TTL, registerKey, redisSafeGet } from "@/lib/cache/redis";

type CacheEntry = {
  value: BrainOutput;
  expiresAt: number;
};

const BRAIN_CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function keyFor(siteId: string, date: string): string {
  return `${siteId}:${date}`;
}

export function getCachedBrain(siteId: string, date: string): BrainOutput | null {
  const key = keyFor(siteId, date);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedBrain(siteId: string, date: string, value: BrainOutput): void {
  cache.set(keyFor(siteId, date), {
    value,
    expiresAt: Date.now() + BRAIN_CACHE_TTL_MS,
  });
  // Also persist to Redis (cross-process, survives cold starts)
  const rKey = cacheKey(siteId, "brain", date);
  getOrSet(rKey, TTL.DASHBOARD_HERO, async () => value).catch(() => {});
  registerKey(siteId, rKey).catch(() => {});
}

/**
 * Try Redis for a cached BrainOutput before triggering a full recompute.
 * Returns null on cache miss or Redis error.
 */
export async function getCachedBrainFromRedis(
  siteId: string,
  date: string,
): Promise<BrainOutput | null> {
  return redisSafeGet<BrainOutput>(cacheKey(siteId, "brain", date));
}

export function invalidateBrainCacheForSite(siteId: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${siteId}:`)) cache.delete(key);
  }
  // Also bust Redis
  invalidateSite(siteId).catch(() => {});
}

