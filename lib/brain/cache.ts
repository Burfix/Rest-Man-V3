import type { BrainOutput } from "@/services/brain/operating-brain";

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
}

export function invalidateBrainCacheForSite(siteId: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${siteId}:`)) cache.delete(key);
  }
}
