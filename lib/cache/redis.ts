/**
 * lib/cache/redis.ts
 *
 * Upstash Redis client and caching utilities.
 *
 * All public helpers are resilient: a Redis failure falls back to the
 * uncached compute path. Redis is an optimisation, never a hard dependency.
 *
 * Key naming convention: `forgestack:{siteId}:{entity}[:{id}]`
 * All keys MUST include siteId — no global/shared cache entries.
 */

import { Redis } from "@upstash/redis";
import { logger } from "@/lib/logger";

// ── Client ────────────────────────────────────────────────────────────────────

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── TTL constants (seconds) ───────────────────────────────────────────────────

export const TTL = {
  /** Score calculation inputs (context-builder output) */
  SCORE_CONTEXT:    300,   // 5 min
  /** Detected cross-module threats (slow-moving) */
  THREAT_CACHE:     600,   // 10 min
  /** Hero strip: score + grade + voice line */
  DASHBOARD_HERO:   180,   // 3 min
  /** Ranked action cards */
  PRIORITY_ACTIONS: 240,   // 4 min
  /** Revenue forecast (stable between syncs) */
  FORECAST:        1800,   // 30 min
  /** Site config weights / thresholds */
  SITE_CONFIG:     3600,   // 1 hour
  /** Health check aggregation */
  HEALTH_STATUS:     60,   // 1 min
} as const;

// ── Key helpers ───────────────────────────────────────────────────────────────

/**
 * Builds a site-scoped cache key.
 * Example: cacheKey("site-1", "context", "2024-01-15") → "forgestack:site-1:context:2024-01-15"
 */
export function cacheKey(siteId: string, entity: string, id?: string): string {
  return id
    ? `forgestack:${siteId}:${entity}:${id}`
    : `forgestack:${siteId}:${entity}`;
}

// ── Tag registry (for site-scoped bulk invalidation) ─────────────────────────

/**
 * Register a key to the site-scoped key set so it can be bulk-invalidated
 * via `invalidateSite(siteId)`.
 *
 * Fire-and-forget — never throws.
 */
export async function registerKey(siteId: string, key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.sadd(`forgestack:${siteId}:_keys`, key);
  } catch (err) {
    logger.warn("cache.registerKey.failed", { siteId, key, err: String(err) });
  }
}

// ── Core read/write ───────────────────────────────────────────────────────────

/**
 * Fetch a value from Redis, or compute it and store it.
 *
 * Resilient: if Redis is unavailable the compute fn is called directly.
 * Never throws — Redis errors are logged and silently bypassed.
 */
export async function getOrSet<T>(
  key: string,
  ttl: number,
  compute: () => Promise<T>,
): Promise<T> {
  const r = getRedis();

  if (r) {
    try {
      const cached = await r.get<T>(key);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    } catch (err) {
      logger.warn("cache.get.failed", { key, err: String(err) });
    }
  }

  // Cache miss (or Redis unavailable) — compute fresh value
  const value = await compute();

  if (r) {
    try {
      await r.set(key, value, { ex: ttl });
    } catch (err) {
      logger.warn("cache.set.failed", { key, err: String(err) });
    }
  }

  return value;
}

// ── Site-scoped invalidation ──────────────────────────────────────────────────

/**
 * Invalidate all Redis keys registered for a site.
 * Called after a MICROS sync or data mutation to bust stale context.
 *
 * Uses a tag set (`forgestack:{siteId}:_keys`) to track keys without SCAN.
 * Never throws — Redis errors are logged and silently bypassed.
 */
export async function invalidateSite(siteId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const keys = await r.smembers(`forgestack:${siteId}:_keys`);
    if (keys.length > 0) {
      await r.del(...(keys as [string, ...string[]]));
    }
    await r.del(`forgestack:${siteId}:_keys`);
    logger.info("cache.invalidateSite", { siteId, keysEvicted: keys.length });
  } catch (err) {
    logger.warn("cache.invalidateSite.failed", { siteId, err: String(err) });
  }
}

/**
 * Delete a single cache key.
 * Never throws.
 */
export async function invalidateKey(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    logger.warn("cache.invalidateKey.failed", { key, err: String(err) });
  }
}

/**
 * Ping Redis to check connectivity.
 * Returns "ok" or "error".
 */
export async function pingRedis(): Promise<"ok" | "error"> {
  const r = getRedis();
  if (!r) return "error";
  try {
    const result = await r.ping();
    return result === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

/**
 * Low-level typed GET from Redis. Returns null on miss or error.
 * Use `getOrSet` when you have a compute fallback; use this for read-only checks.
 */
export async function redisSafeGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get<T>(key);
  } catch (err) {
    logger.warn("cache.safeGet.failed", { key, err: String(err) });
    return null;
  }
}
