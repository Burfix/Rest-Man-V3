/**
 * lib/reliability/score.ts — Per-site operational reliability scoring
 *
 * Computes a 0–100 reliability score for a site from the last 7 days of
 * micros_sync_runs history. This is the quantitative foundation for:
 *   - Head Office reliability dashboards
 *   - GM trust signals ("Is my data pipeline healthy?")
 *   - Support tooling ("Why is Sea Castle reporting stale data?")
 *   - Enterprise SLA reporting
 *
 * Scoring model:
 *   - Sales feed    40% weight  (revenue is the primary signal)
 *   - Labour feed   35% weight  (cost signal, executive sensitivity)
 *   - Inventory feed 25% weight (operational risk, lower data frequency)
 *
 * Each feed is scored 0–100 from:
 *   - Success rate:         60 pts  (success / total attempts × 60)
 *   - Freshness:            25 pts  (time since last success)
 *   - Failure streak bonus: 15 pts  (deducted if 2+ consecutive failures)
 */

import { createServerClient } from "@/lib/supabase/server";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReliabilityGrade = "A" | "B" | "C" | "D";

export interface FeedReliability {
  /** The sync type this refers to */
  feedType: "sales" | "labour" | "inventory";
  /** 0–100 feed-level score */
  score: number;
  /** success / total in the window */
  successRate: number;
  /** Total runs attempted in the window */
  totalRuns: number;
  /** ISO timestamp of most recent successful run */
  lastSuccessAt: string | null;
  /** Minutes since last successful run (null if never) */
  minutesSinceSuccess: number | null;
  /** Number of most-recent consecutive failures */
  consecutiveFailures: number;
}

export interface ReliabilityScore {
  siteId: string;
  /** Weighted overall 0–100 */
  overall: number;
  /** Letter grade */
  grade: ReliabilityGrade;
  /** Per-feed breakdown */
  feeds: FeedReliability[];
  /** ISO timestamp this score was computed */
  computedAt: string;
  /** Days of history used */
  windowDays: number;
}

// ── Internal run row ─────────────────────────────────────────────────────────

interface SyncRunRow {
  status: "success" | "partial" | "error" | "running" | string;
  sync_type: string;
  started_at: string;
  completed_at: string | null;
}

// ── Private helpers ──────────────────────────────────────────────────────────

const FEED_WEIGHTS: Record<FeedReliability["feedType"], number> = {
  sales:     0.40,
  labour:    0.35,
  inventory: 0.25,
};

// sync_type values in micros_sync_runs that map to each feed
const SYNC_TYPE_MAP: Record<FeedReliability["feedType"], string[]> = {
  sales:     ["daily_totals", "full", "sales"],
  labour:    ["labor", "labour"],
  inventory: ["inventory"],
};

function gradeFromScore(score: number): ReliabilityGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

function scoreFromFreshnessMinutes(minutes: number | null): number {
  if (minutes === null) return 0;
  if (minutes <=  30) return 25;
  if (minutes <=  60) return 20;
  if (minutes <= 120) return 15;
  if (minutes <= 240) return 8;
  if (minutes <= 480) return 3;
  return 0;
}

function computeFeedScore(runs: SyncRunRow[]): Omit<FeedReliability, "feedType"> {
  if (runs.length === 0) {
    return {
      score: 0,
      successRate: 0,
      totalRuns: 0,
      lastSuccessAt: null,
      minutesSinceSuccess: null,
      consecutiveFailures: 0,
    };
  }

  const terminal = runs.filter((r) => r.status !== "running");
  const successes = terminal.filter((r) => r.status === "success" || r.status === "partial");
  const successRate = terminal.length > 0 ? successes.length / terminal.length : 0;

  // Latest success
  const sorted = [...successes].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
  const lastSuccessAt = sorted[0]?.completed_at ?? sorted[0]?.started_at ?? null;
  const minutesSinceSuccess = lastSuccessAt
    ? Math.round((Date.now() - new Date(lastSuccessAt).getTime()) / 60_000)
    : null;

  // Consecutive failures from most recent runs
  const chronological = [...terminal].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
  let consecutiveFailures = 0;
  for (const r of chronological) {
    if (r.status === "error") consecutiveFailures++;
    else break;
  }

  // Score components
  const successPts  = Math.round(successRate * 60);
  const freshPts    = scoreFromFreshnessMinutes(minutesSinceSuccess);
  const streakDeduct = consecutiveFailures >= 3 ? 15 : consecutiveFailures === 2 ? 8 : 0;
  const score = Math.max(0, Math.min(100, successPts + freshPts - streakDeduct));

  return {
    score,
    successRate: Math.round(successRate * 1000) / 10, // one decimal
    totalRuns: runs.length,
    lastSuccessAt,
    minutesSinceSuccess,
    consecutiveFailures,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute a reliability score for a site from the last `windowDays` of
 * micros_sync_runs history.
 *
 * Returns a default "no data" score (overall=0, grade=D) when the site
 * has no MICROS connection or no sync history.
 */
export async function computeReliabilityScore(
  siteId: string,
  windowDays = 7,
): Promise<ReliabilityScore> {
  const computedAt = new Date().toISOString();

  try {
    const supabase = createServerClient();
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    // Join micros_sync_runs → micros_connections to filter by site_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("micros_sync_runs")
      .select("status, sync_type, started_at, completed_at, micros_connections!inner(site_id)")
      .eq("micros_connections.site_id", siteId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);

    if (error || !data) {
      return noDataScore(siteId, computedAt, windowDays);
    }

    const rows = data as Array<SyncRunRow & { micros_connections: { site_id: string } }>;

    const feeds: FeedReliability[] = (
      ["sales", "labour", "inventory"] as FeedReliability["feedType"][]
    ).map((feedType) => {
      const matchTypes = new Set(SYNC_TYPE_MAP[feedType]);
      const feedRuns = rows.filter((r) => matchTypes.has(r.sync_type));
      return { feedType, ...computeFeedScore(feedRuns) };
    });

    const overall = Math.round(
      feeds.reduce((sum, f) => sum + f.score * FEED_WEIGHTS[f.feedType], 0),
    );

    return {
      siteId,
      overall,
      grade: gradeFromScore(overall),
      feeds,
      computedAt,
      windowDays,
    };
  } catch {
    return noDataScore(siteId, computedAt, windowDays);
  }
}

function noDataScore(siteId: string, computedAt: string, windowDays: number): ReliabilityScore {
  const feeds: FeedReliability[] = (
    ["sales", "labour", "inventory"] as FeedReliability["feedType"][]
  ).map((feedType) => ({
    feedType,
    score: 0,
    successRate: 0,
    totalRuns: 0,
    lastSuccessAt: null,
    minutesSinceSuccess: null,
    consecutiveFailures: 0,
  }));

  return { siteId, overall: 0, grade: "D", feeds, computedAt, windowDays };
}
