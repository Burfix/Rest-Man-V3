/**
 * lib/reliability/trend.ts
 *
 * Per-day reliability trend from micros_sync_runs history.
 *
 * Instead of the full `computeReliabilityScore()` freshness model (which
 * applies "how stale is it NOW?"), trend uses per-day success rate only.
 * This gives an honest backward-looking view: how well did each feed
 * perform on each day?
 *
 * One DB query; partitioned in memory by date bucket.
 * Safe to call from any server context.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger }             from "@/lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DailyFeedStats {
  feedType: "sales" | "labour" | "inventory";
  successRate: number;      // 0–100
  totalRuns: number;
  successCount: number;
}

export interface DailyReliability {
  date: string;             // YYYY-MM-DD (UTC)
  /** 0–100 weighted success rate across all feeds that day */
  overall: number;
  feeds: DailyFeedStats[];
  /** True if this day had any sync activity */
  hasData: boolean;
}

export interface ReliabilityTrend {
  siteId: string;
  days: DailyReliability[];
  /** Days with at least one sync attempt */
  activeDays: number;
  /** 7-day weighted average of the `overall` field */
  trendScore: number;
  computedAt: string;
}

// ── Feed → sync_type mapping (mirrors score.ts) ───────────────────────────────

const SYNC_TYPE_MAP: Record<DailyFeedStats["feedType"], string[]> = {
  sales:     ["daily_totals", "full", "sales"],
  labour:    ["labor", "labour"],
  inventory: ["inventory"],
};

const FEED_WEIGHTS: Record<DailyFeedStats["feedType"], number> = {
  sales:     0.40,
  labour:    0.35,
  inventory: 0.25,
};

// ── Private helpers ───────────────────────────────────────────────────────────

function toDateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function buildEmptyDay(date: string): DailyReliability {
  return {
    date,
    overall: 0,
    hasData: false,
    feeds: (["sales", "labour", "inventory"] as DailyFeedStats["feedType"][]).map((f) => ({
      feedType: f,
      successRate: 0,
      totalRuns: 0,
      successCount: 0,
    })),
  };
}

function weightedOverall(feeds: DailyFeedStats[]): number {
  let sum = 0;
  for (const f of feeds) {
    sum += f.successRate * FEED_WEIGHTS[f.feedType];
  }
  return Math.round(sum);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute per-day reliability trend for `days` calendar days (default 14).
 *
 * Returns one `DailyReliability` entry per day, most-recent day first.
 * Days with no sync activity are included with `hasData: false`.
 */
export async function computeReliabilityTrend(
  siteId: string,
  days = 14,
): Promise<ReliabilityTrend> {
  const computedAt = new Date().toISOString();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Generate the date range (most recent first)
  const dateKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dateKeys.push(toDateKey(d.toISOString()));
  }

  // Initialise a map of empty days
  const dayMap = new Map<string, DailyReliability>(
    dateKeys.map((d) => [d, buildEmptyDay(d)]),
  );

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (createServerClient() as any)
      .from("micros_sync_runs")
      .select("status, sync_type, started_at, micros_connections!inner(site_id)")
      .eq("micros_connections.site_id", siteId)
      .gte("started_at", since)
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1000);

    if (error || !data) {
      logger.warn("reliability.trend.query_failed", { siteId, err: error?.message });
      return buildResult(siteId, dateKeys, dayMap, computedAt);
    }

    // Partition runs into day buckets
    for (const row of data as Array<{ status: string; sync_type: string; started_at: string }>) {
      const dateKey = toDateKey(row.started_at);
      const day = dayMap.get(dateKey);
      if (!day) continue; // outside our window — shouldn't happen with gte filter

      const isSuccess = row.status === "success" || row.status === "partial";

      for (const [feedType, syncTypes] of Object.entries(SYNC_TYPE_MAP) as [DailyFeedStats["feedType"], string[]][]) {
        if (!syncTypes.includes(row.sync_type)) continue;

        const feed = day.feeds.find((f) => f.feedType === feedType);
        if (!feed) continue;
        feed.totalRuns++;
        if (isSuccess) feed.successCount++;
        day.hasData = true;
      }
    }

    // Compute per-feed success rate + overall for each day
    for (const day of Array.from(dayMap.values())) {
      for (const feed of day.feeds) {
        feed.successRate =
          feed.totalRuns > 0
            ? Math.round((feed.successCount / feed.totalRuns) * 100)
            : 0;
      }
      day.overall = weightedOverall(day.feeds);
    }
  } catch (err) {
    logger.warn("reliability.trend.error", { siteId, err: String(err) });
  }

  return buildResult(siteId, dateKeys, dayMap, computedAt);
}

function buildResult(
  siteId: string,
  dateKeys: string[],
  dayMap: Map<string, DailyReliability>,
  computedAt: string,
): ReliabilityTrend {
  const orderedDays = dateKeys.map((d) => dayMap.get(d)!);
  const activeDays  = orderedDays.filter((d) => d.hasData).length;
  const scored      = orderedDays.filter((d) => d.hasData);
  const trendScore  = scored.length > 0
    ? Math.round(scored.reduce((s, d) => s + d.overall, 0) / scored.length)
    : 0;

  return { siteId, days: orderedDays, activeDays, trendScore, computedAt };
}
