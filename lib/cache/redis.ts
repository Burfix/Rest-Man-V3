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

// ── Command count (for monitoring) ───────────────────────────────────────────

/** Module-level counter — resets on cold start / process restart. */
let _commandCount = 0;
const LOG_THRESHOLD = 100;

/** Return the number of Redis commands issued since process start (or last reset). */
export function getCommandCount(): number {
  return _commandCount;
}

/** Reset the counter (e.g. at start of a new calendar day). */
export function resetCommandCount(): void {
  _commandCount = 0;
}

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
  SCORE_CONTEXT:    600,   // 10 min (was 300) — context stable between ticks
  /** Detected cross-module threats (slow-moving) */
  THREAT_CACHE:     900,   // 15 min (was 600) — threats are slow-moving
  /** Hero strip: score + grade + voice line */
  DASHBOARD_HERO:   300,   // 5 min (was 180) — GM won't perceive 2 min diff
  /** Ranked action cards */
  PRIORITY_ACTIONS: 600,   // 10 min (was 240) — actions change on duty completion
  /** Revenue forecast (stable between syncs) */
  FORECAST:        7200,   // 2 hours (was 1800) — forecasts are stable
  /** Site config weights / thresholds */
  SITE_CONFIG:    21600,   // 6 hours (was 3600) — config changes are rare
  /** Health check aggregation */
  HEALTH_STATUS:     60,   // 1 min (unchanged)
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
    _commandCount++;
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
      _commandCount++;
      if (_commandCount % LOG_THRESHOLD === 0) {
        logger.info("cache.commands", { count: _commandCount });
      }
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
      _commandCount++;
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
    _commandCount++;
    const keys = await r.smembers(`forgestack:${siteId}:_keys`);
    if (keys.length > 0) {
      await batchDel([...keys, `forgestack:${siteId}:_keys`]);
    } else {
      _commandCount++;
      await r.del(`forgestack:${siteId}:_keys`);
    }
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
    _commandCount++;
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
    _commandCount++;
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
    _commandCount++;
    return await r.get<T>(key);
  } catch (err) {
    logger.warn("cache.safeGet.failed", { key, err: String(err) });
    return null;
  }
}

// ── Batch operations ──────────────────────────────────────────────

/** @internal Split an array into chunks of `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );
}

/**
 * Write multiple keys in parallel (one command per key — Upstash has no MSET TTL).
 * Never throws — Redis errors are logged and silently bypassed.
 */
export async function batchSet(
  items: { key: string; value: unknown; ttl: number }[],
): Promise<void> {
  const r = getRedis();
  if (!r || items.length === 0) return;
  try {
    _commandCount += items.length;
    await Promise.all(items.map((item) => r.set(item.key, item.value, { ex: item.ttl })));
  } catch (err) {
    logger.warn("cache.batchSet.failed", { count: items.length, err: String(err) });
  }
}

/**
 * Delete multiple keys in batches of 100 (Upstash DEL limit).
 * Includes the tag-set key itself when called from invalidateSite.
 * Never throws.
 */
export async function batchDel(keys: string[]): Promise<void> {
  const r = getRedis();
  if (!r || keys.length === 0) return;
  try {
    const batches = chunk(keys, 100);
    _commandCount += batches.length;
    await Promise.all(batches.map((batch) => r.del(...(batch as [string, ...string[]]))));
  } catch (err) {
    logger.warn("cache.batchDel.failed", { count: keys.length, err: String(err) });
  }
}
