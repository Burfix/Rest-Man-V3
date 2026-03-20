/**
 * Head Office Control Tower — multi-store aggregation service.
 *
 * Data source: store_snapshots (daily per-store metrics cache).
 * Each store's daily-ops reset upserts a snapshot row; the HQ view
 * reads the latest snapshot per site for group-level reporting.
 *
 * Functions:
 *   getAllActiveSites()      — all active sites from the sites table
 *   getStoreSummaries()      — latest snapshot per site → StoreSummary[]
 *   computeGroupMetrics()    — aggregate totals + averages (pure, no DB)
 *   buildLeaderboard()       — sort by score, tag top/bottom 3 (pure, no DB)
 *   getGroupTrends(days?)    — 7-day trend arrays per site
 *   getGroupActionStats()    — live action counts from the actions table
 */

import { createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { ScoreGrade } from "@/services/ops/operatingScore";

type SiteRow = Database["public"]["Tables"]["sites"]["Row"];
type SnapRow = Database["public"]["Tables"]["store_snapshots"]["Row"];

// ── Types ──────────────────────────────────────────────────────────────────────

export type RiskLevel = "green" | "yellow" | "red";

export interface StoreSummary {
  site_id:               string;
  name:                  string;
  city:                  string;
  operating_score:       number | null;
  score_grade:           ScoreGrade | null;
  sales_net_vat:         number | null;
  revenue_target:        number | null;
  /** positive = below target, negative = above target */
  revenue_gap_pct:       number | null;
  labour_pct:            number | null;
  compliance_score:      number | null;
  maintenance_score:     number | null;
  risk_level:            RiskLevel;
  actions_total:         number;
  actions_completed:     number;
  actions_overdue:       number;
  actions_completion_pct: number | null;
  snapshot_date:         string | null;
}

export interface GroupMetrics {
  store_count:             number;
  total_revenue:           number | null;
  total_revenue_target:    number | null;
  group_revenue_gap_pct:   number | null;  // positive = below target
  avg_operating_score:     number | null;
  avg_labour_pct:          number | null;
  compliance_risk_count:   number;    // stores with compliance_score < 20
  maintenance_risk_count:  number;    // stores with maintenance_score < 20
  red_stores:              number;
  yellow_stores:           number;
  green_stores:            number;
  total_actions_open:      number;
  total_actions_overdue:   number;
  total_actions_completed: number;
  group_completion_pct:    number | null;
}

export interface StoreLeaderboardEntry extends StoreSummary {
  rank:      number;
  is_top:    boolean;   // top 3
  is_bottom: boolean;   // bottom 3 (non-overlapping with top)
}

export interface DailyTrendPoint {
  date:  string;         // YYYY-MM-DD
  value: number | null;
}

export interface StoreTrendLine {
  site_id: string;
  name:    string;
  points:  DailyTrendPoint[];
}

export interface GroupTrends {
  revenue:    StoreTrendLine[];
  labour:     StoreTrendLine[];
  risk_score: StoreTrendLine[];
}

export interface StoreActionStats {
  site_id:        string;
  name:           string;
  total:          number;
  completed:      number;
  open:           number;
  overdue:        number;
  completion_pct: number | null;
}

export interface GroupCriticalAction {
  site_id:   string;
  site_name: string;
  category:  "compliance" | "revenue" | "maintenance" | "actions";
  severity:  "critical" | "urgent";
  message:   string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function deriveRisk(score: number | null): RiskLevel {
  if (score === null) return "yellow";
  if (score < 45)     return "red";
  if (score < 70)     return "yellow";
  return "green";
}

// ── Queries ────────────────────────────────────────────────────────────────────

export async function getAllActiveSites(): Promise<Pick<SiteRow, "id" | "name" | "city" | "timezone" | "is_active">[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, city, timezone, is_active")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(`[HeadOffice] sites: ${error.message}`);
  return (data ?? []) as Pick<SiteRow, "id" | "name" | "city" | "timezone" | "is_active">[];
}

export async function getStoreSummaries(): Promise<StoreSummary[]> {
  const supabase = createServerClient();

  const sites = await getAllActiveSites();
  if (sites.length === 0) return [];

  const siteIds = sites.map((s) => s.id);

  // Latest snapshot per site — ordered DESC, first hit per site wins
  const { data: snaps, error: snapErr } = await supabase
    .from("store_snapshots")
    .select("*")
    .in("site_id", siteIds)
    .order("snapshot_date", { ascending: false });

  if (snapErr) throw new Error(`[HeadOffice] snapshots: ${snapErr.message}`);

  // Keep only the most recent snapshot per site
  const rows = (snaps ?? []) as SnapRow[];
  const latest: Record<string, SnapRow> = {};
  for (const snap of rows) {
    if (!latest[snap.site_id]) latest[snap.site_id] = snap;
  }

  return sites.map((site): StoreSummary => {
    const snap = latest[site.id] ?? null;
    const score            = snap?.operating_score ?? null;
    const actionsTotal     = snap?.actions_total     ?? 0;
    const actionsCompleted = snap?.actions_completed ?? 0;

    return {
      site_id:               site.id,
      name:                  site.name,
      city:                  site.city ?? "—",
      operating_score:       score,
      score_grade:           (snap?.score_grade as ScoreGrade | null) ?? null,
      sales_net_vat:         snap?.sales_net_vat     != null ? Number(snap.sales_net_vat)     : null,
      revenue_target:        snap?.revenue_target    != null ? Number(snap.revenue_target)    : null,
      revenue_gap_pct:       snap?.revenue_gap_pct   != null ? Number(snap.revenue_gap_pct)   : null,
      labour_pct:            snap?.labour_pct        != null ? Number(snap.labour_pct)        : null,
      compliance_score:      snap?.compliance_score  ?? null,
      maintenance_score:     snap?.maintenance_score ?? null,
      risk_level:            (snap?.risk_level as RiskLevel | null) ?? deriveRisk(score),
      actions_total:         actionsTotal,
      actions_completed:     actionsCompleted,
      actions_overdue:       snap?.actions_overdue ?? 0,
      actions_completion_pct:
        actionsTotal > 0
          ? Math.round((actionsCompleted / actionsTotal) * 100)
          : null,
      snapshot_date: snap?.snapshot_date ?? null,
    };
  });
}

// ── Pure aggregation (no DB calls) ─────────────────────────────────────────────

export function computeGroupMetrics(summaries: StoreSummary[]): GroupMetrics {
  const withScore  = summaries.filter((s) => s.operating_score !== null);
  const withLabour = summaries.filter((s) => s.labour_pct !== null);
  const withRev    = summaries.filter((s) => s.sales_net_vat !== null);

  const totalRevenue = withRev.length > 0
    ? withRev.reduce((sum, s) => sum + (s.sales_net_vat ?? 0), 0)
    : null;
  const totalTarget = withRev.length > 0
    ? withRev.reduce((sum, s) => sum + (s.revenue_target ?? 0), 0)
    : null;

  const totalCreated   = summaries.reduce((sum, s) => sum + s.actions_total,     0);
  const totalCompleted = summaries.reduce((sum, s) => sum + s.actions_completed, 0);

  return {
    store_count:            summaries.length,
    total_revenue:          totalRevenue,
    total_revenue_target:   totalTarget,
    avg_operating_score:    withScore.length > 0
      ? Math.round(withScore.reduce((sum, s) => sum + (s.operating_score ?? 0), 0) / withScore.length)
      : null,
    avg_labour_pct:         withLabour.length > 0
      ? Math.round((withLabour.reduce((sum, s) => sum + (s.labour_pct ?? 0), 0) / withLabour.length) * 10) / 10
      : null,
    compliance_risk_count:  summaries.filter((s) => s.compliance_score !== null && s.compliance_score < 20).length,
    maintenance_risk_count: summaries.filter((s) => s.maintenance_score !== null && s.maintenance_score < 20).length,
    red_stores:    summaries.filter((s) => s.risk_level === "red").length,
    yellow_stores: summaries.filter((s) => s.risk_level === "yellow").length,
    green_stores:  summaries.filter((s) => s.risk_level === "green").length,
    total_actions_open:      totalCreated - totalCompleted,
    total_actions_overdue:   summaries.reduce((sum, s) => sum + s.actions_overdue, 0),
    total_actions_completed: totalCompleted,
    group_completion_pct:    totalCreated > 0
      ? Math.round((totalCompleted / totalCreated) * 100)
      : null,
    group_revenue_gap_pct:   totalTarget != null && totalTarget > 0 && totalRevenue != null
      ? Math.round(((totalTarget - totalRevenue) / totalTarget) * 100)
      : null,
  };
}

// ── Pure analysis helpers ──────────────────────────────────────────────────────

export function getCriticalActionsFromSummaries(
  summaries: StoreSummary[]
): GroupCriticalAction[] {
  const out: GroupCriticalAction[] = [];

  for (const s of summaries) {
    if ((s.compliance_score ?? 20) === 0) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "compliance",   severity: "critical", message: "Compliance expired — immediate renewal required" });
    }
    if ((s.maintenance_score ?? 20) === 0) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "maintenance",  severity: "critical", message: "Critical maintenance issue — service disruption risk" });
    }
    if (s.revenue_gap_pct !== null && s.revenue_gap_pct > 25) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "revenue",      severity: "critical", message: `${s.revenue_gap_pct.toFixed(1)}% below revenue target` });
    } else if (s.revenue_gap_pct !== null && s.revenue_gap_pct > 10) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "revenue",      severity: "urgent",   message: `${s.revenue_gap_pct.toFixed(1)}% below revenue target` });
    }
    if (s.actions_overdue > 3) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "actions",      severity: "critical", message: `${s.actions_overdue} overdue actions — escalation needed` });
    } else if (s.actions_overdue > 0) {
      out.push({ site_id: s.site_id, site_name: s.name, category: "actions",      severity: "urgent",   message: `${s.actions_overdue} overdue action${s.actions_overdue > 1 ? "s" : ""} not completed` });
    }
  }

  // Critical first, then urgent
  return out.sort((a, b) => (a.severity === "critical" ? 0 : 1) - (b.severity === "critical" ? 0 : 1));
}

export function computeLabourTrendDirection(trends: GroupTrends): "up" | "down" | "flat" {
  const firstVals: number[] = [];
  const lastVals:  number[] = [];

  for (const line of trends.labour) {
    const valid = line.points.filter((p): p is { date: string; value: number } => p.value !== null);
    if (valid.length >= 2) {
      firstVals.push(valid[0].value);
      lastVals.push(valid[valid.length - 1].value);
    }
  }

  if (firstVals.length === 0) return "flat";
  const avgFirst = firstVals.reduce((s, v) => s + v, 0) / firstVals.length;
  const avgLast  = lastVals.reduce((s, v)  => s + v, 0) / lastVals.length;
  const delta    = avgLast - avgFirst;
  if (Math.abs(delta) < 0.5) return "flat";
  return delta > 0 ? "up" : "down";
}

export function buildLeaderboard(summaries: StoreSummary[]): StoreLeaderboardEntry[] {
  const sorted = [...summaries].sort((a, b) => {
    const aScore = a.operating_score ?? -1;
    const bScore = b.operating_score ?? -1;
    return bScore - aScore;
  });

  const n      = sorted.length;
  const topN   = Math.min(3, Math.ceil(n / 2));
  const botN   = Math.min(3, Math.floor(n / 2));

  return sorted.map((s, i): StoreLeaderboardEntry => ({
    ...s,
    rank:      i + 1,
    is_top:    i < topN,
    is_bottom: i >= n - botN && i >= topN,
  }));
}

// ── Trend queries ──────────────────────────────────────────────────────────────

export async function getGroupTrends(days = 7): Promise<GroupTrends> {
  const supabase = createServerClient();

  const sites = await getAllActiveSites();
  if (sites.length === 0) return { revenue: [], labour: [], risk_score: [] };

  const siteIds = sites.map((s) => s.id);
  const siteMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  const since = new Date(Date.now() - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: snaps } = await supabase
    .from("store_snapshots")
    .select("site_id, snapshot_date, sales_net_vat, labour_pct, operating_score")
    .in("site_id", siteIds)
    .gte("snapshot_date", since)
    .order("snapshot_date");

  type TrendSnap = Pick<SnapRow, "site_id" | "snapshot_date" | "sales_net_vat" | "labour_pct" | "operating_score">;

  const grouped: Record<string, TrendSnap[]> = Object.fromEntries(siteIds.map((id) => [id, []]));
  for (const snap of (snaps ?? []) as TrendSnap[]) {
    grouped[snap.site_id]?.push(snap);
  }

  const revenue:    StoreTrendLine[] = [];
  const labour:     StoreTrendLine[] = [];
  const risk_score: StoreTrendLine[] = [];

  for (const siteId of siteIds) {
    const pts  = grouped[siteId] ?? [];
    const name = siteMap[siteId] ?? siteId;
    revenue.push({    site_id: siteId, name, points: pts.map((p) => ({ date: p.snapshot_date, value: p.sales_net_vat    })) });
    labour.push({     site_id: siteId, name, points: pts.map((p) => ({ date: p.snapshot_date, value: p.labour_pct       })) });
    risk_score.push({ site_id: siteId, name, points: pts.map((p) => ({ date: p.snapshot_date, value: p.operating_score  })) });
  }

  return { revenue, labour, risk_score };
}

// ── Live action stats ──────────────────────────────────────────────────────────

export async function getGroupActionStats(): Promise<StoreActionStats[]> {
  const supabase = createServerClient();

  const sites   = await getAllActiveSites();
  const siteIds = sites.map((s) => s.id);

  const { data: actions } = await supabase
    .from("actions")
    .select("site_id, status, created_at")
    .in("site_id", siteIds)
    .is("archived_at", null);

  const OVERDUE_MS = 24 * 3_600_000;
  const now        = Date.now();

  type Stats = { total: number; completed: number; overdue: number };
  const bySite: Record<string, Stats> = Object.fromEntries(
    siteIds.map((id) => [id, { total: 0, completed: 0, overdue: 0 }])
  );

  type ActionRow = { site_id: string | null; status: string; created_at: string };
  for (const action of (actions ?? []) as ActionRow[]) {
    const sid = action.site_id;
    if (!sid || !bySite[sid]) continue;
    bySite[sid].total++;
    if (action.status === "completed") {
      bySite[sid].completed++;
    } else if (now - new Date(action.created_at).getTime() > OVERDUE_MS) {
      bySite[sid].overdue++;
    }
  }

  return sites.map((site): StoreActionStats => {
    const s = bySite[site.id] ?? { total: 0, completed: 0, overdue: 0 };
    return {
      site_id:        site.id,
      name:           site.name,
      total:          s.total,
      completed:      s.completed,
      open:           s.total - s.completed,
      overdue:        s.overdue,
      completion_pct: s.total > 0 ? Math.round((s.completed / s.total) * 100) : null,
    };
  });
}
