/**
 * Weekly Performance Report — Data Aggregation Service
 *
 * Functions:
 *   getWeekRange(date?)                       — compute Mon–Sun week bounds
 *   getWeeklyPerformance(orgId, weekRange)    — group-level summary
 *   getStoreWeeklyRanking(orgId, weekRange)   — stores ranked by execution + impact
 *   getGMWeeklyPerformance(orgId, weekRange)  — per-GM accountability
 *   getWeeklyImpactSummary(orgId, weekRange)  — impact grouped by category/store/manager
 *   getWeeklyServiceInsights(orgId, weekRange)— service trends
 *   generateWeeklyReport(orgId, weekRange?)   — full structured report
 *
 * Data sources:
 *   - store_snapshots         (daily per-site metrics)
 *   - actions + action_events (lifecycle + impact)
 *   - daily_operations_reports(service-level granularity)
 *   - reviews                 (ratings + sentiment)
 *   - service_signals         (avg_spend, walk-in conversion)
 *   - sites                   (multi-tenant roster)
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type {
  WeekRange,
  WeeklyPerformance,
  StoreWeeklyRank,
  GMWeeklyPerformance,
  WeeklyImpactSummary,
  ImpactByCategory,
  ImpactByStore,
  ImpactByManager,
  ServiceInsights,
  InterventionItem,
  FocusItem,
  WeeklyReport,
  TrendDirection,
} from "@/types/weekly-report";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Week Range Helpers ─────────────────────────────────────────────────────────

/** Returns the ISO week number for a given date. */
function isoWeekNumber(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Compute the Mon–Sun week range containing the given date.
 * Defaults to the *previous* full week if called on a weekday.
 */
export function getWeekRange(dateStr?: string): WeekRange {
  const now = dateStr ? new Date(dateStr + "T12:00:00Z") : new Date();
  const day = now.getUTCDay();
  // Go to Monday of the current week
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);

  // If we haven't finished the week yet, go back one full week
  if (!dateStr && day !== 0 && day < 7) {
    monday.setUTCDate(monday.getUTCDate() - 7);
  }

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
    weekNumber: isoWeekNumber(monday),
    year: monday.getUTCFullYear(),
  };
}

/** Get the previous week's range relative to the given week. */
function prevWeekRange(week: WeekRange): WeekRange {
  const d = new Date(week.start + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 7);
  return getWeekRange(d.toISOString().slice(0, 10));
}

function fmt(d: string): string { return d; } // date passthrough

// ── Shared DB Queries ──────────────────────────────────────────────────────────

interface SiteRow { id: string; name: string; city: string | null; }

async function getActiveSites(orgId: string): Promise<SiteRow[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, city")
    .eq("organisation_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(`[WeeklyReport] sites: ${error.message}`);
  return (data ?? []) as SiteRow[];
}

interface SnapshotRow {
  site_id: string;
  snapshot_date: string;
  operating_score: number | null;
  score_grade: string | null;
  sales_net_vat: number | null;
  revenue_target: number | null;
  revenue_gap_pct: number | null;
  labour_pct: number | null;
  compliance_score: number | null;
  maintenance_score: number | null;
  risk_level: string;
  actions_total: number;
  actions_completed: number;
  actions_overdue: number;
}

async function getSnapshotsForWeek(siteIds: string[], week: WeekRange): Promise<SnapshotRow[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("store_snapshots")
    .select("site_id, snapshot_date, operating_score, score_grade, sales_net_vat, revenue_target, revenue_gap_pct, labour_pct, compliance_score, maintenance_score, risk_level, actions_total, actions_completed, actions_overdue")
    .in("site_id", siteIds)
    .gte("snapshot_date", week.start)
    .lte("snapshot_date", week.end)
    .order("snapshot_date");
  if (error) throw new Error(`[WeeklyReport] snapshots: ${error.message}`);
  return (data ?? []) as SnapshotRow[];
}

interface ActionRow {
  id: string;
  site_id: string | null;
  category: string | null;
  status: string;
  severity: string | null;
  created_at: string;
  completed_at: string | null;
  escalated_at: string | null;
  owner: string | null;
  impact_after: any;
  expected_impact_value: number | null;
}

async function getActionsForWeek(siteIds: string[], week: WeekRange): Promise<ActionRow[]> {
  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("actions")
    .select("id, site_id, category, status, severity, created_at, completed_at, escalated_at, owner, impact_after, expected_impact_value")
    .in("site_id", siteIds)
    .gte("created_at", week.start + "T00:00:00Z")
    .lte("created_at", week.end + "T23:59:59Z");
  if (error) throw new Error(`[WeeklyReport] actions: ${error.message}`);
  return (data ?? []) as ActionRow[];
}

function computeTrend(current: number | null, previous: number | null): TrendDirection {
  if (current == null || previous == null) return "flat";
  const delta = current - previous;
  if (Math.abs(delta) < 0.5) return "flat";
  return delta > 0 ? "up" : "down";
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
}

function sum(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0);
}

function gradeFromScore(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function extractImpactValue(action: ActionRow): number | null {
  if (action.impact_after?.delta != null) return Number(action.impact_after.delta);
  if (action.expected_impact_value != null) return Number(action.expected_impact_value);
  return null;
}

// ── 1. Weekly Performance ──────────────────────────────────────────────────────

export async function getWeeklyPerformance(
  orgId: string,
  weekRange: WeekRange,
  _sites?: SiteRow[],
): Promise<WeeklyPerformance> {
  const sites = _sites ?? await getActiveSites(orgId);
  const siteIds = sites.map((s) => s.id);
  if (siteIds.length === 0) {
    return emptyPerformance(weekRange);
  }

  const prev = prevWeekRange(weekRange);
  const [snapshots, prevSnapshots, actions] = await Promise.all([
    getSnapshotsForWeek(siteIds, weekRange),
    getSnapshotsForWeek(siteIds, prev),
    getActionsForWeek(siteIds, weekRange),
  ]);

  // Revenue: sum daily sales across all stores for the week
  const totalRevenue = sum(snapshots.map((s) => s.sales_net_vat != null ? Number(s.sales_net_vat) : null));
  const totalRevenueTarget = sum(snapshots.map((s) => s.revenue_target != null ? Number(s.revenue_target) : null));
  const prevRevenue = sum(prevSnapshots.map((s) => s.sales_net_vat != null ? Number(s.sales_net_vat) : null));
  const revenueGapPct = totalRevenueTarget && totalRevenue != null
    ? Math.round(((totalRevenueTarget - totalRevenue) / totalRevenueTarget) * 100 * 10) / 10
    : null;

  // Execution: avg of latest snapshot score per store this week
  const latestPerSite = getLatestSnapshotPerSite(snapshots);
  const scores = Object.values(latestPerSite).map((s) => s.operating_score);
  const avgExec = avg(scores);
  const prevLatest = getLatestSnapshotPerSite(prevSnapshots);
  const prevAvgExec = avg(Object.values(prevLatest).map((s) => s.operating_score));

  // Actions
  const escalated = actions.filter((a) => a.escalated_at != null).length;
  const completed = actions.filter((a) => a.status === "completed").length;
  const overdue = actions.filter((a) => {
    if (a.status === "completed") return false;
    const age = Date.now() - new Date(a.created_at).getTime();
    return age > 24 * 3_600_000;
  }).length;

  // Impact
  const impacts = actions.map(extractImpactValue).filter((v): v is number => v != null);
  const totalImpact = impacts.length > 0 ? impacts.reduce((s, v) => s + v, 0) : null;

  // Service: avg spend from daily_operations_reports
  const supabase = createServerClient();
  const { data: opsRows } = await supabase
    .from("daily_operations_reports" as any)
    .select("guests_average_spend, guest_count")
    .in("site_id", siteIds)
    .gte("report_date", weekRange.start)
    .lte("report_date", weekRange.end);
  const ops = (opsRows ?? []) as any[];
  const avgSpendVal = avg(ops.map((o) => o.guests_average_spend != null ? Number(o.guests_average_spend) : null));
  const totalCovers = sum(ops.map((o) => o.guest_count != null ? Number(o.guest_count) : null));

  // Prev week avg spend
  const { data: prevOpsRows } = await supabase
    .from("daily_operations_reports" as any)
    .select("guests_average_spend")
    .in("site_id", siteIds)
    .gte("report_date", prev.start)
    .lte("report_date", prev.end);
  const prevAvgSpend = avg(((prevOpsRows ?? []) as any[]).map((o) => o.guests_average_spend != null ? Number(o.guests_average_spend) : null));

  // Reviews avg rating for the week
  const { data: reviewRows } = await supabase
    .from("reviews")
    .select("rating")
    .in("site_id", siteIds)
    .gte("review_date", weekRange.start)
    .lte("review_date", weekRange.end);
  const avgRating = avg(((reviewRows ?? []) as any[]).map((r) => Number(r.rating)));

  return {
    weekRange,
    storeCount: sites.length,
    totalRevenue,
    totalRevenueTarget: totalRevenueTarget,
    revenueGapPct,
    revenueTrend: computeTrend(totalRevenue, prevRevenue),
    avgExecutionScore: avgExec,
    executionGrade: gradeFromScore(avgExec),
    executionTrend: computeTrend(avgExec, prevAvgExec),
    actionsAssigned: actions.length,
    actionsCompleted: completed,
    actionsOverdue: overdue,
    actionsEscalated: escalated,
    completionRate: actions.length > 0 ? Math.round((completed / actions.length) * 100) : null,
    totalImpactGenerated: totalImpact,
    avgSpend: avgSpendVal,
    avgSpendTrend: computeTrend(avgSpendVal, prevAvgSpend),
    totalCovers,
    avgRating,
  };
}

function emptyPerformance(weekRange: WeekRange): WeeklyPerformance {
  return {
    weekRange, storeCount: 0,
    totalRevenue: null, totalRevenueTarget: null, revenueGapPct: null, revenueTrend: "flat",
    avgExecutionScore: null, executionGrade: null, executionTrend: "flat",
    actionsAssigned: 0, actionsCompleted: 0, actionsOverdue: 0, actionsEscalated: 0, completionRate: null,
    totalImpactGenerated: null,
    avgSpend: null, avgSpendTrend: "flat", totalCovers: null, avgRating: null,
  };
}

function getLatestSnapshotPerSite(snapshots: SnapshotRow[]): Record<string, SnapshotRow> {
  const latest: Record<string, SnapshotRow> = {};
  // Snapshots arrive ordered by date ASC — last write wins
  for (const snap of snapshots) {
    latest[snap.site_id] = snap;
  }
  return latest;
}

// ── 2. Store Ranking ───────────────────────────────────────────────────────────

export async function getStoreWeeklyRanking(
  orgId: string,
  weekRange: WeekRange,
  _sites?: SiteRow[],
): Promise<StoreWeeklyRank[]> {
  const sites = _sites ?? await getActiveSites(orgId);
  const siteIds = sites.map((s) => s.id);
  if (siteIds.length === 0) return [];

  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s]));

  const [snapshots, prevSnapshots, actions] = await Promise.all([
    getSnapshotsForWeek(siteIds, weekRange),
    getSnapshotsForWeek(siteIds, prevWeekRange(weekRange)),
    getActionsForWeek(siteIds, weekRange),
  ]);

  // Group snapshots per site
  const bySite: Record<string, SnapshotRow[]> = {};
  for (const id of siteIds) bySite[id] = [];
  for (const s of snapshots) bySite[s.site_id]?.push(s);

  const prevLatest = getLatestSnapshotPerSite(prevSnapshots);

  // Group actions per site
  const actionsBySite: Record<string, ActionRow[]> = {};
  for (const id of siteIds) actionsBySite[id] = [];
  for (const a of actions) if (a.site_id) actionsBySite[a.site_id]?.push(a);

  const ranks: StoreWeeklyRank[] = siteIds.map((siteId) => {
    const site = siteMap[siteId]!;
    const siteSnaps = bySite[siteId] ?? [];
    const siteActions = actionsBySite[siteId] ?? [];

    const scores = siteSnaps.map((s) => s.operating_score).filter((s): s is number => s != null);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const prevScore = prevLatest[siteId]?.operating_score ?? null;

    const revenue = sum(siteSnaps.map((s) => s.sales_net_vat != null ? Number(s.sales_net_vat) : null));
    const target = sum(siteSnaps.map((s) => s.revenue_target != null ? Number(s.revenue_target) : null));
    const gapPct = target && revenue != null ? Math.round(((target - revenue) / target) * 100 * 10) / 10 : null;

    const completed = siteActions.filter((a) => a.status === "completed").length;
    const overdue = siteActions.filter((a) => a.status !== "completed" && (Date.now() - new Date(a.created_at).getTime()) > 24 * 3_600_000).length;
    const impacts = siteActions.map(extractImpactValue).filter((v): v is number => v != null);
    const impactTotal = impacts.length > 0 ? impacts.reduce((s, v) => s + v, 0) : null;

    return {
      rank: 0,
      siteId,
      storeName: site.name,
      city: site.city ?? "—",
      avgExecutionScore: avgScore,
      totalRevenue: revenue,
      revenueGapPct: gapPct,
      actionsCompleted: completed,
      actionsOverdue: overdue,
      completionRate: siteActions.length > 0 ? Math.round((completed / siteActions.length) * 100) : null,
      impactGenerated: impactTotal,
      trend: computeTrend(avgScore, prevScore),
    };
  });

  // Sort by execution score DESC, then impact DESC
  ranks.sort((a, b) => {
    const scoreDiff = (b.avgExecutionScore ?? -1) - (a.avgExecutionScore ?? -1);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.impactGenerated ?? -1) - (a.impactGenerated ?? -1);
  });

  ranks.forEach((r, i) => { r.rank = i + 1; });
  return ranks;
}

// ── 3. GM Performance ──────────────────────────────────────────────────────────

export async function getGMWeeklyPerformance(
  orgId: string,
  weekRange: WeekRange,
  _sites?: SiteRow[],
): Promise<GMWeeklyPerformance[]> {
  const sites = _sites ?? await getActiveSites(orgId);
  const siteIds = sites.map((s) => s.id);
  if (siteIds.length === 0) return [];

  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s]));

  const [snapshots, prevSnapshots, actions] = await Promise.all([
    getSnapshotsForWeek(siteIds, weekRange),
    getSnapshotsForWeek(siteIds, prevWeekRange(weekRange)),
    getActionsForWeek(siteIds, weekRange),
  ]);

  // Try to get GM name from user_profiles
  const supabase = createServerClient();
  const { data: profiles } = await (supabase as any)
    .from("user_profiles")
    .select("site_id, full_name, role")
    .in("site_id", siteIds)
    .eq("role", "gm");
  const gmBySite: Record<string, string> = {};
  for (const p of (profiles ?? []) as any[]) {
    if (p.site_id && p.full_name) gmBySite[p.site_id] = p.full_name;
  }

  const bySite: Record<string, SnapshotRow[]> = {};
  for (const id of siteIds) bySite[id] = [];
  for (const s of snapshots) bySite[s.site_id]?.push(s);

  const prevLatest = getLatestSnapshotPerSite(prevSnapshots);

  const actionsBySite: Record<string, ActionRow[]> = {};
  for (const id of siteIds) actionsBySite[id] = [];
  for (const a of actions) if (a.site_id) actionsBySite[a.site_id]?.push(a);

  return siteIds.map((siteId): GMWeeklyPerformance => {
    const site = siteMap[siteId]!;
    const siteSnaps = bySite[siteId] ?? [];
    const siteActions = actionsBySite[siteId] ?? [];

    const scores = siteSnaps.map((s) => s.operating_score).filter((s): s is number => s != null);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const prevScore = prevLatest[siteId]?.operating_score ?? null;

    const completed = siteActions.filter((a) => a.status === "completed").length;
    const overdue = siteActions.filter((a) => a.status !== "completed" && (Date.now() - new Date(a.created_at).getTime()) > 24 * 3_600_000).length;
    const escalated = siteActions.filter((a) => a.escalated_at != null).length;
    const impacts = siteActions.map(extractImpactValue).filter((v): v is number => v != null);

    return {
      siteId,
      storeName: site.name,
      gmName: gmBySite[siteId] ?? null,
      executionScore: avgScore,
      completionRate: siteActions.length > 0 ? Math.round((completed / siteActions.length) * 100) : null,
      overdueActions: overdue,
      escalations: escalated,
      impactGenerated: impacts.length > 0 ? impacts.reduce((s, v) => s + v, 0) : null,
      prevWeekScore: prevScore,
      scoreDelta: avgScore != null && prevScore != null ? avgScore - prevScore : null,
    };
  });
}

// ── 4. Impact Analytics ────────────────────────────────────────────────────────

export async function getWeeklyImpactSummary(
  orgId: string,
  weekRange: WeekRange,
  _sites?: SiteRow[],
): Promise<WeeklyImpactSummary> {
  const sites = _sites ?? await getActiveSites(orgId);
  const siteIds = sites.map((s) => s.id);
  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s]));

  if (siteIds.length === 0) {
    return { totalImpact: null, actionsWithImpact: 0, byCategory: [], byStore: [], byManager: [] };
  }

  const actions = await getActionsForWeek(siteIds, weekRange);
  const withImpact = actions.filter((a) => extractImpactValue(a) != null);

  // By category
  const catMap: Record<string, { count: number; total: number }> = {};
  for (const a of withImpact) {
    const cat = a.category ?? "general";
    if (!catMap[cat]) catMap[cat] = { count: 0, total: 0 };
    catMap[cat].count++;
    catMap[cat].total += extractImpactValue(a) ?? 0;
  }
  const byCategory: ImpactByCategory[] = Object.entries(catMap)
    .map(([category, v]) => ({
      category,
      count: v.count,
      totalImpact: v.total,
      avgImpact: v.count > 0 ? Math.round(v.total / v.count) : null,
    }))
    .sort((a, b) => (b.totalImpact ?? 0) - (a.totalImpact ?? 0));

  // By store
  const storeMap: Record<string, { count: number; total: number }> = {};
  for (const a of withImpact) {
    const sid = a.site_id ?? "unknown";
    if (!storeMap[sid]) storeMap[sid] = { count: 0, total: 0 };
    storeMap[sid].count++;
    storeMap[sid].total += extractImpactValue(a) ?? 0;
  }
  const byStore: ImpactByStore[] = Object.entries(storeMap)
    .map(([siteId, v]) => ({
      siteId,
      storeName: siteMap[siteId]?.name ?? "Unknown",
      count: v.count,
      totalImpact: v.total,
    }))
    .sort((a, b) => (b.totalImpact ?? 0) - (a.totalImpact ?? 0));

  // By manager (owner field on actions)
  const mgrMap: Record<string, { siteId: string; count: number; total: number }> = {};
  for (const a of withImpact) {
    const mgr = a.owner ?? "Unassigned";
    if (!mgrMap[mgr]) mgrMap[mgr] = { siteId: a.site_id ?? "", count: 0, total: 0 };
    mgrMap[mgr].count++;
    mgrMap[mgr].total += extractImpactValue(a) ?? 0;
  }
  const byManager: ImpactByManager[] = Object.entries(mgrMap)
    .map(([gmName, v]) => ({
      gmName,
      siteId: v.siteId,
      count: v.count,
      totalImpact: v.total,
    }))
    .sort((a, b) => (b.totalImpact ?? 0) - (a.totalImpact ?? 0));

  const allImpacts = withImpact.map(extractImpactValue).filter((v): v is number => v != null);
  return {
    totalImpact: allImpacts.length > 0 ? allImpacts.reduce((s, v) => s + v, 0) : null,
    actionsWithImpact: withImpact.length,
    byCategory,
    byStore,
    byManager,
  };
}

// ── 5. Service Insights ────────────────────────────────────────────────────────

export async function getWeeklyServiceInsights(
  orgId: string,
  weekRange: WeekRange,
  _sites?: SiteRow[],
): Promise<ServiceInsights> {
  const supabase = createServerClient();
  const sites = _sites ?? await getActiveSites(orgId);
  const siteIds = sites.map((s) => s.id);
  const prev = prevWeekRange(weekRange);

  if (siteIds.length === 0) {
    return {
      avgSpend: null, avgSpendPrevWeek: null, avgSpendTrend: "flat",
      totalCovers: null, coversPrevWeek: null,
      avgRating: null, ratingPrevWeek: null, ratingTrend: "flat",
      topPerformingStore: null, lowestPerformingStore: null,
    };
  }

  // Daily ops reports for avg spend + covers
  const [opsRes, prevOpsRes, reviewRes, prevReviewRes] = await Promise.all([
    supabase
      .from("daily_operations_reports" as any)
      .select("guests_average_spend, guest_count")
      .in("site_id", siteIds)
      .gte("report_date", weekRange.start)
      .lte("report_date", weekRange.end),
    supabase
      .from("daily_operations_reports" as any)
      .select("guests_average_spend, guest_count")
      .in("site_id", siteIds)
      .gte("report_date", prev.start)
      .lte("report_date", prev.end),
    supabase
      .from("reviews")
      .select("rating, site_id")
      .in("site_id", siteIds)
      .gte("review_date", weekRange.start)
      .lte("review_date", weekRange.end),
    supabase
      .from("reviews")
      .select("rating")
      .in("site_id", siteIds)
      .gte("review_date", prev.start)
      .lte("review_date", prev.end),
  ]);

  const ops = (opsRes.data ?? []) as any[];
  const prevOps = (prevOpsRes.data ?? []) as any[];
  const reviews = (reviewRes.data ?? []) as any[];
  const prevReviews = (prevReviewRes.data ?? []) as any[];

  const avgSpendVal = avg(ops.map((o) => o.guests_average_spend != null ? Number(o.guests_average_spend) : null));
  const prevAvgSpend = avg(prevOps.map((o) => o.guests_average_spend != null ? Number(o.guests_average_spend) : null));
  const totalCovers = sum(ops.map((o) => o.guest_count != null ? Number(o.guest_count) : null));
  const prevCovers = sum(prevOps.map((o) => o.guest_count != null ? Number(o.guest_count) : null));
  const avgRating = avg(reviews.map((r) => Number(r.rating)));
  const prevRating = avg(prevReviews.map((r) => Number(r.rating)));

  // Per-store avg rating for top/lowest
  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));
  const ratingBySite: Record<string, number[]> = {};
  for (const r of reviews) {
    const sid = r.site_id;
    if (!sid) continue;
    if (!ratingBySite[sid]) ratingBySite[sid] = [];
    ratingBySite[sid].push(Number(r.rating));
  }
  const siteAvgRatings = Object.entries(ratingBySite)
    .map(([sid, ratings]) => ({
      siteId: sid,
      name: siteMap[sid] ?? "Unknown",
      avg: ratings.reduce((s, v) => s + v, 0) / ratings.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  return {
    avgSpend: avgSpendVal,
    avgSpendPrevWeek: prevAvgSpend,
    avgSpendTrend: computeTrend(avgSpendVal, prevAvgSpend),
    totalCovers,
    coversPrevWeek: prevCovers,
    avgRating,
    ratingPrevWeek: prevRating,
    ratingTrend: computeTrend(avgRating, prevRating),
    topPerformingStore: siteAvgRatings.length > 0 ? siteAvgRatings[0].name : null,
    lowestPerformingStore: siteAvgRatings.length > 1 ? siteAvgRatings[siteAvgRatings.length - 1].name : null,
  };
}

// ── Intervention + Focus Generation ────────────────────────────────────────────

function buildInterventions(
  ranking: StoreWeeklyRank[],
  gms: GMWeeklyPerformance[],
): InterventionItem[] {
  const items: InterventionItem[] = [];

  for (const store of ranking) {
    if (store.avgExecutionScore != null && store.avgExecutionScore < 45) {
      items.push({
        store: store.storeName,
        siteId: store.siteId,
        issue: `Execution score critically low (${store.avgExecutionScore}/100)`,
        severity: "critical",
        recommendation: "Schedule immediate ops review with GM",
      });
    } else if (store.avgExecutionScore != null && store.avgExecutionScore < 55) {
      items.push({
        store: store.storeName,
        siteId: store.siteId,
        issue: `Execution score below threshold (${store.avgExecutionScore}/100)`,
        severity: "high",
        recommendation: "Area manager check-in required this week",
      });
    }

    if (store.actionsOverdue > 3) {
      items.push({
        store: store.storeName,
        siteId: store.siteId,
        issue: `${store.actionsOverdue} overdue actions`,
        severity: store.actionsOverdue > 5 ? "critical" : "high",
        recommendation: "Review action queue and reassign or escalate",
      });
    }

    if (store.revenueGapPct != null && store.revenueGapPct > 20) {
      items.push({
        store: store.storeName,
        siteId: store.siteId,
        issue: `Revenue ${store.revenueGapPct.toFixed(1)}% below target`,
        severity: store.revenueGapPct > 30 ? "critical" : "high",
        recommendation: "Activate revenue recovery initiatives",
      });
    }
  }

  for (const gm of gms) {
    if (gm.escalations > 2) {
      items.push({
        store: gm.storeName,
        siteId: gm.siteId,
        issue: `${gm.escalations} escalated actions — potential accountability gap`,
        severity: "medium",
        recommendation: "1-on-1 with GM to review escalation causes",
      });
    }
  }

  // Sort by severity: critical > high > medium
  const sev: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  items.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));
  return items;
}

function buildFocusItems(
  summary: WeeklyPerformance,
  interventions: InterventionItem[],
): FocusItem[] {
  const items: FocusItem[] = [];

  if (summary.completionRate != null && summary.completionRate < 60) {
    items.push({
      area: "Execution",
      description: `Action completion rate at ${summary.completionRate}% — target 80%+. Review action assignment cadence.`,
      priority: "critical",
    });
  }

  if (summary.revenueGapPct != null && summary.revenueGapPct > 10) {
    items.push({
      area: "Revenue",
      description: `Group revenue ${summary.revenueGapPct.toFixed(1)}% below target. Activate promotions and upselling.`,
      priority: summary.revenueGapPct > 20 ? "critical" : "high",
    });
  }

  if (summary.actionsOverdue > 5) {
    items.push({
      area: "Accountability",
      description: `${summary.actionsOverdue} overdue actions across group. Enforce daily action review.`,
      priority: "high",
    });
  }

  if (summary.actionsEscalated > 3) {
    items.push({
      area: "Escalation Management",
      description: `${summary.actionsEscalated} escalations this week. Increase GM ownership.`,
      priority: "medium",
    });
  }

  const criticalStores = interventions.filter((i) => i.severity === "critical").length;
  if (criticalStores > 0) {
    items.push({
      area: "Store Interventions",
      description: `${criticalStores} store${criticalStores > 1 ? "s" : ""} need immediate attention. Schedule site visits.`,
      priority: "critical",
    });
  }

  if (summary.avgSpendTrend === "down") {
    items.push({
      area: "Service Quality",
      description: "Average spend trending down — review upselling training and menu engineering.",
      priority: "medium",
    });
  }

  items.sort((a, b) => {
    const p: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    return (p[a.priority] ?? 9) - (p[b.priority] ?? 9);
  });

  return items;
}

// ── 6. Report Generator ────────────────────────────────────────────────────────

export async function generateWeeklyReport(
  orgId: string,
  weekRange?: WeekRange,
): Promise<WeeklyReport> {
  const week = weekRange ?? getWeekRange();

  logger.info("[WeeklyReport] Generating report", { orgId, week: week.start });

  // Fetch sites once and pass through to all aggregation functions
  const sites = await getActiveSites(orgId);

  const [summary, storeRanking, gmPerformance, impactSummary, serviceInsights] = await Promise.all([
    getWeeklyPerformance(orgId, week, sites),
    getStoreWeeklyRanking(orgId, week, sites),
    getGMWeeklyPerformance(orgId, week, sites),
    getWeeklyImpactSummary(orgId, week, sites),
    getWeeklyServiceInsights(orgId, week, sites),
  ]);

  const interventionList = buildInterventions(storeRanking, gmPerformance);
  const nextWeekFocus = buildFocusItems(summary, interventionList);

  const storesAbove70 = storeRanking.filter((s) => (s.avgExecutionScore ?? 0) >= 70).length;
  const storesBelow45 = storeRanking.filter((s) => (s.avgExecutionScore ?? 0) < 45).length;

  const report: WeeklyReport = {
    id: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    weekRange: week,
    orgId,
    summary,
    storeRanking,
    gmPerformance,
    executionStats: {
      avgScore: summary.avgExecutionScore,
      grade: summary.executionGrade,
      trend: summary.executionTrend,
      storesAbove70,
      storesBelow45,
    },
    impactSummary,
    serviceInsights,
    interventionList,
    nextWeekFocus,
  };

  logger.info("[WeeklyReport] Report generated", {
    orgId,
    weekStart: week.start,
    stores: summary.storeCount,
    interventions: interventionList.length,
  });

  return report;
}
