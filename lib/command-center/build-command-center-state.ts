/**
 * lib/command-center/build-command-center-state.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * COMMAND CENTER — SINGLE STATE BUILDER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This is the ONLY place that derives the canonical Command Center state.
 * All panels (Hero, Business Status, System Pulse, Command Feed, Service Pulse)
 * MUST read from the object returned here — never from independent calculations.
 *
 * Scoring model (authoritative):
 *   Revenue  30 pts | Labour 20 pts | Duties 20 pts | Maint 15 pts | Comp 15 pts
 *
 * Data flow:
 *   Raw data fetches → runOperatingBrain() → buildCommandCenterState() → API / page
 *
 * The brain is the canonical scorer.  evaluateOperations() is the canonical
 * command-feed / business-status generator.  Both are called with the SAME
 * raw inputs so their outputs cannot diverge.
 */

import { getTodayBookingsSummary }    from "@/services/ops/bookingsSummary";
import { getSevenDayReviewSummary }   from "@/services/ops/reviewsSummary";
import { getMaintenanceSummary }      from "@/services/ops/maintenanceSummary";
import { getUpcomingEvents }          from "@/services/ops/eventsSummary";
import { getDataFreshnessSummary }    from "@/services/ops/dataFreshness";
import { generateRevenueForecast }    from "@/services/revenue/forecast";
import { getComplianceSummary }       from "@/services/ops/complianceSummary";
import { getMicrosStatus }            from "@/services/micros/status";
import { getMicrosConfigStatus }      from "@/lib/micros/config";
import { deriveMicrosIntegrationStatus, canUseMicrosLiveData } from "@/lib/integrations/status";
import { getCurrentSalesSnapshot, snapshotToProvenance } from "@/lib/sales/service";
import { getInventoryIntelligence, inventoryToProvenance } from "@/services/inventory/intelligence";
import { getStoredDailySummary }      from "@/services/micros/labour/summary";
import { evaluateOperations }         from "@/services/decision-engine";
import { getServicePeriod }           from "@/lib/commandCenter";
import { getSiteConfig }              from "@/lib/config/site";
import { runOperatingBrain }          from "@/services/brain/operating-brain";
import { createServerClient }         from "@/lib/supabase/server";
import { todayISO }                   from "@/lib/utils";
import { resolveRevenueTarget, safeLabourPct } from "@/lib/targets/resolveRevenueTarget";

import type { BrainOutput }               from "@/services/brain/operating-brain";
import type { NormalizedSalesSnapshot }   from "@/lib/sales/types";
import type { DataProvenance }            from "@/lib/types/data-provenance";
import type { EvaluateOperationsOutput }  from "@/services/decision-engine";
import type { RevenueForecast, ComplianceSummary, MaintenanceSummary, SevenDayReviewSummary } from "@/types";
import type { MicrosStatusSummary }       from "@/types/micros";
import type { PredictiveSignals }         from "@/components/operating-brain/BusinessStatusRail";
import type { FeedbackLoopProps }         from "@/components/operating-brain/FeedbackLoop";
import type { DutiesData }                from "@/components/brain/PriorityActionBoard";

import { buildOperationalState }        from "@/lib/ops/build-operational-state";
import type { ForecastConfidence }       from "@/lib/ops/risk-vector";
import { persistOperatingScore }        from "@/lib/scores/persistOperatingScore";

import {
  type CommandCenterState,
  type CanonicalScore,
  type CanonicalRevenue,
  type CanonicalLabour,
  type CanonicalCompliance,
  type CanonicalMaintenance,
  type HeroBanner,
  type BusinessStatusItem,
  type SystemPulse,
  type CommandFeedItem,
  type ServiceSession,
  type DataReliability,
  type RevenueStatus,
  type LabourStatus,
  type ComplianceStatus,
  type MaintenanceStatus,
  type BusinessStatusTone,
  type ScoreGrade,
  toCanonicalGrade,
  toScoreStatus,
  ptsToNextGrade,
} from "./types";

// ── Empty fallbacks (identical to what the page used) ─────────────────────────

const EMPTY_TODAY   = { total: 0, totalCovers: 0, largeBookings: 0, eventLinked: 0, escalationsToday: 0, bookings: [] };
const EMPTY_REVIEWS: SevenDayReviewSummary = { byPlatform: [], overallAverage: 0, totalReviews: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, flaggedReviews: [] };
const EMPTY_COMPLIANCE: ComplianceSummary = {
  total: 0, compliant: 0, scheduled: 0, due_soon: 0, expired: 0, unknown: 0,
  compliance_pct: 0, critical_items: [], due_soon_items: [], scheduled_items: [],
};
const EMPTY_MAINTENANCE: MaintenanceSummary = {
  totalEquipment: 0, openRepairs: 0, inProgress: 0, awaitingParts: 0, outOfService: 0,
  urgentIssues: [], resolvedThisWeek: 0, avgFixTimeDays: null, monthlyActualCost: null,
  topProblemAsset: null, foodSafetyRisks: 0, serviceDisruptions: 0, complianceRisks: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function settled<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
): { value: T; error: string | null } {
  if (result.status === "fulfilled") return { value: result.value, error: null };
  const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { value: fallback, error: msg };
}

function fmtZAR(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtPct(n: number, showSign = false): string {
  const s = showSign && n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

/** Derive revenue reliability from available data sources. */
function revenueReliability(snapshot: NormalizedSalesSnapshot): DataReliability {
  if (snapshot.source === "micros" && snapshot.isLive) return "live";
  if (snapshot.source === "manual")  return "stale";
  if (snapshot.source === "forecast") return "insufficient";
  if (snapshot.netSales === 0)        return "missing";
  return "stale";
}

/** Labour reliability is downgraded when revenue data is insufficient. */
function labourReliability(
  labourSummary: Awaited<ReturnType<typeof getStoredDailySummary>> | null,
  revReliability: DataReliability,
): DataReliability {
  if (!labourSummary || labourSummary.totalLabourHours === 0) return "missing";
  if (revReliability === "missing" || revReliability === "insufficient") return "insufficient";
  if (labourSummary.labourPercentOfSales !== null) return "live";
  return "stale";
}

/** Map raw revenue pct gap to RevenueStatus. */
function revenueStatus(gapPct: number, reliability: DataReliability): RevenueStatus {
  if (reliability === "missing") return "unknown";
  if (gapPct >= 0) return "on_target";
  if (gapPct >= -10) return "behind";
  if (gapPct >= -20) return "at_risk";
  return "critical";
}

/** Map labour % vs target to LabourStatus. */
function labourStatus(pct: number, targetPct: number, reliability: DataReliability): LabourStatus {
  if (reliability === "missing") return "unknown";
  const variance = pct - targetPct;
  if (variance <= 0) return pct <= 18 ? "efficient" : "healthy";
  if (variance <= 5)  return "elevated";
  if (variance <= 15) return "high";
  return "critical";
}

/** Map compliance data to ComplianceStatus. */
function complianceStatus(summary: ComplianceSummary): ComplianceStatus {
  if (summary.total === 0) return "not_configured";
  if (summary.expired > 0) return "critical";
  if (summary.due_soon > 0) return "at_risk";
  return "ok";
}

/** Map maintenance data to MaintenanceStatus. */
function maintenanceStatus(summary: MaintenanceSummary): MaintenanceStatus {
  if (summary.foodSafetyRisks > 0 || summary.serviceDisruptions > 0) return "critical";
  if (summary.urgentIssues.length > 0) return "attention";
  return "ok";
}

/** Hero severity from score status. */
function heroSeverity(status: string): "good" | "warning" | "critical" {
  if (status === "strong" || status === "ok") return "good";
  if (status === "at_risk") return "warning";
  return "critical";
}

/** Convert evaluateOperations businessStatus tone to canonical tone. */
function mapTone(tone: string): BusinessStatusTone {
  if (tone === "positive") return "positive";
  if (tone === "warning")  return "warning";
  if (tone === "critical") return "critical";
  return "neutral";
}

/** Convert evaluateOperations commandFeed to canonical CommandFeedItem[]. */
function mapCommandFeed(decisions: EvaluateOperationsOutput["commandFeed"]): CommandFeedItem[] {
  return decisions.map((d) => ({
    id:          d.id,
    severity:    d.severity as CommandFeedItem["severity"],
    category:    (d.category ?? "revenue") as CommandFeedItem["category"],
    title:       d.title,
    description: d.explanation ?? "",
    action:      d.action ?? "",
    ifIgnored:   null,
    owner:       null,
    deadline:    d.due ?? null,
    impact:      d.impact?.label ?? null,
    status:      "pending",
  }));
}

// ── Business status builder ───────────────────────────────────────────────────

function buildBusinessStatus(params: {
  revenue: CanonicalRevenue;
  labour:  CanonicalLabour;
  compliance: CanonicalCompliance;
  maintenance: CanonicalMaintenance;
  /** Raw evaluateOperations output — used for existing labels/supportingText */
  engineStatus: EvaluateOperationsOutput["businessStatus"];
}): BusinessStatusItem[] {
  const { revenue, labour, compliance, maintenance, engineStatus } = params;

  const items: BusinessStatusItem[] = [];

  // ── Revenue ──────────────────────────────────────────────────────────────────
  items.push({
    key:   "revenue",
    label: engineStatus.revenue.label,
    value: fmtZAR(revenue.actual),
    delta: revenue.gapPct !== 0 ? fmtPct(revenue.gapPct, true) : null,
    status: mapTone(engineStatus.revenue.tone),
    severity: revenue.status === "critical" ? "critical" : revenue.status === "at_risk" ? "high" : revenue.status === "behind" ? "medium" : "good",
    source: "revenue",
  });

  // ── Labour ───────────────────────────────────────────────────────────────────
  const labourLabel = labour.reliability === "missing" || labour.reliability === "insufficient"
    ? "Not available"
    : engineStatus.labour.label;
  items.push({
    key:   "labour",
    label: labourLabel,
    value: labour.reliability !== "missing" ? fmtPct(labour.labourPct) : "—",
    delta: labour.reliability !== "missing" ? fmtPct(labour.variancePct, true) : null,
    status: mapTone(engineStatus.labour.tone),
    severity: labour.status === "critical" ? "critical" : labour.status === "high" ? "high" : labour.status === "elevated" ? "medium" : "good",
    source: "labour",
  });

  // ── Maintenance ───────────────────────────────────────────────────────────────
  items.push({
    key:   "maintenance",
    label: engineStatus.maintenance.label,
    value: `${maintenance.openItems} open`,
    delta: maintenance.criticalItems > 0 ? `${maintenance.criticalItems} critical` : null,
    status: mapTone(engineStatus.maintenance.tone),
    severity: maintenance.status === "critical" ? "critical" : maintenance.status === "attention" ? "medium" : "good",
    source: "maintenance",
  });

  // ── Compliance ────────────────────────────────────────────────────────────────
  const complianceLabel = compliance.status === "not_configured"
    ? "Not configured"
    : engineStatus.compliance.label;
  items.push({
    key:   "compliance",
    label: complianceLabel,
    value: compliance.status === "not_configured"
      ? "—"
      : `${compliance.compliantCount}/${compliance.totalCount}`,
    delta: compliance.expiredCount > 0 ? `${compliance.expiredCount} expired` : null,
    status: mapTone(engineStatus.compliance.tone),
    severity: compliance.status === "critical" ? "critical" : compliance.status === "at_risk" ? "medium" : "good",
    source: "compliance",
  });

  return items;
}

// ── Hero builder (from brain's primaryThreat) ─────────────────────────────────

function buildHero(brain: BrainOutput, score: CanonicalScore): HeroBanner {
  const primary = brain.primaryThreat;
  const sev = primary.severity;

  let severity: HeroBanner["severity"] = "good";
  if (sev === "critical" || sev === "high") severity = "critical";
  else if (sev === "medium") severity = "warning";
  else if (score.status === "critical" || score.status === "at_risk") severity = "warning";

  return {
    headline: primary.title,
    subline:  primary.description,
    severity,
  };
}

// ── Fastest path to next grade ────────────────────────────────────────────────

function buildFastestPath(score: CanonicalScore): string | null {
  const { nextGrade, pts } = ptsToNextGrade(score.value);
  if (!nextGrade) return null;

  // Find the lowest-scoring module whose improvement would earn the most pts.
  const gaps: Array<{ module: string; missing: number }> = [
    { module: "revenue",     missing: score.breakdown.revenue.max     - score.breakdown.revenue.pts     },
    { module: "labour",      missing: score.breakdown.labour.max      - score.breakdown.labour.pts      },
    { module: "duties",      missing: score.breakdown.duties.max      - score.breakdown.duties.pts      },
    { module: "maintenance", missing: score.breakdown.maintenance.max - score.breakdown.maintenance.pts },
    { module: "compliance",  missing: score.breakdown.compliance.max  - score.breakdown.compliance.pts  },
  ].filter((g) => g.missing > 0).sort((a, b) => b.missing - a.missing);

  if (gaps.length === 0) return null;

  const top = gaps[0];
  return `+${pts} pts needed for grade ${nextGrade} — fix ${top.module} first (+${top.missing} pts available)`;
}

// ── Canonical score from brain ────────────────────────────────────────────────

function buildCanonicalScore(brain: BrainOutput): CanonicalScore {
  const sh = brain.systemHealth;
  const all = sh.allScoreDrivers;

  const rev   = all.find((d) => d.module === "REVENUE")     ?? { pts: 0, reason: "No data", connected: false };
  const lab   = all.find((d) => d.module === "LABOUR")      ?? { pts: 0, reason: "No data", connected: false };
  const dut   = all.find((d) => d.module === "DUTIES")      ?? { pts: 20, reason: "Full credit (pre-duty window)" };
  const maint = all.find((d) => d.module === "MAINTENANCE") ?? { pts: 15, reason: "No data" };
  const comp  = all.find((d) => d.module === "COMPLIANCE")  ?? { pts: 15, reason: "No data" };

  const rawScore = sh.score;
  // Apply canonical grade thresholds (spec: A≥85, B≥70, C≥55, D≥40, F<40)
  // Note: brain internal grades use different thresholds (A≥90, B≥80, C≥65, D≥50)
  const grade  = toCanonicalGrade(rawScore);
  const status = toScoreStatus(rawScore);

  const drivers = sh.scoreDrivers
    .filter((d) => d.direction === "down")
    .map((d) => d.module.charAt(0) + d.module.slice(1).toLowerCase())
    .slice(0, 3);

  const score: CanonicalScore = {
    value:  rawScore,
    grade,
    status,
    drivers,
    explanation: brain.voiceLine ?? sh.scoreDrivers.map((d) => d.reason).join(" · "),
    breakdown: {
      revenue:     { pts: rev.pts,   max: 30, explanation: rev.reason,   connected: (rev as any).connected },
      labour:      { pts: lab.pts,   max: 20, explanation: lab.reason,   connected: (lab as any).connected },
      duties:      { pts: dut.pts,   max: 20, explanation: dut.reason   },
      maintenance: { pts: maint.pts, max: 15, explanation: maint.reason },
      compliance:  { pts: comp.pts,  max: 15, explanation: comp.reason  },
    },
  };

  return score;
}

// ── System Pulse from canonical score ─────────────────────────────────────────

function buildSystemPulse(score: CanonicalScore, brain: BrainOutput): SystemPulse {
  const all = brain.systemHealth.allScoreDrivers;
  const rev   = all.find((d) => d.module === "REVENUE")     ?? { pts: 0, reason: "", connected: false };
  const lab   = all.find((d) => d.module === "LABOUR")      ?? { pts: 0, reason: "", connected: false };
  const dut   = all.find((d) => d.module === "DUTIES")      ?? { pts: 20, reason: "" };
  const maint = all.find((d) => d.module === "MAINTENANCE") ?? { pts: 15, reason: "" };
  const comp  = all.find((d) => d.module === "COMPLIANCE")  ?? { pts: 15, reason: "" };

  const projectedClose = brain.forecastSummary.projectedClose > 0
    ? brain.forecastSummary.projectedClose
    : null;

  return {
    score:   score.value,
    grade:   score.grade,
    drivers: score.drivers,
    breakdown: {
      revenue:     { pts: rev.pts,   max: 30, reason: rev.reason,   connected: (rev as any).connected },
      labour:      { pts: lab.pts,   max: 20, reason: lab.reason,   connected: (lab as any).connected },
      duties:      { pts: dut.pts,   max: 20, reason: dut.reason   },
      maintenance: { pts: maint.pts, max: 15, reason: maint.reason },
      compliance:  { pts: comp.pts,  max: 15, reason: comp.reason  },
    },
    fastestPathToNextGrade: buildFastestPath(score),
    projectedClose,
  };
}

// ── Service session ───────────────────────────────────────────────────────────

function buildServiceSession(tz = "Africa/Johannesburg"): ServiceSession {
  const period = getServicePeriod(tz);
  const hourStr = new Date().toLocaleTimeString("en-ZA", { timeZone: tz, hour: "2-digit", hour12: false });
  const hour = parseInt(hourStr, 10);
  // Service opens at 10:00 SAST; minutesElapsed counts from then.
  const openHour = 10;
  const minutesElapsed = Math.max(0, (hour - openHour) * 60);
  const isDutyWindow = minutesElapsed >= 120; // noon onwards
  return { period, hour, minutesElapsed, isDutyWindow };
}

// ── Duties data helper ────────────────────────────────────────────────────────

async function fetchDutiesData(siteId: string, todayDate: string): Promise<DutiesData | undefined> {
  try {
    const supabase = createServerClient() as any;
    const { data: taskRows } = await supabase
      .from("daily_ops_tasks")
      .select("id, action_name, status, assigned_to, due_time")
      .eq("site_id", siteId)
      .eq("task_date", todayDate)
      .order("sort_order", { ascending: true });

    if (!taskRows || taskRows.length === 0) return undefined;

    const userIds = Array.from(new Set(
      (taskRows as any[]).map((t: any) => t.assigned_to).filter(Boolean)
    )) as string[];
    const profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of (profiles ?? []) as any[]) {
        profileMap[p.id] = p.full_name || p.email;
      }
    }

    const allTasks = (taskRows as any[]).map((t: any) => ({
      id:               t.id as string,
      action_name:      t.action_name as string,
      status:           t.status as string,
      assigned_to_name: t.assigned_to ? (profileMap[t.assigned_to] ?? null) : null,
      due_time:         t.due_time as string | null,
    }));

    return {
      tasks:          allTasks,
      totalCount:     allTasks.length,
      completedCount: allTasks.filter((t) => t.status === "completed").length,
    };
  } catch {
    return undefined;
  }
}

// ── Public result type ────────────────────────────────────────────────────────

/**
 * Everything the Command Center page needs — one call, one truth.
 * The `state` field is serialisable (for the API route).
 * The `extras` field contains SSR-only data (brain, snapshots, component props).
 */
export interface CommandCenterStateResult {
  /** Canonical serialisable state — used by the API route and all display logic. */
  state: CommandCenterState;

  /** SSR extras — NOT serialised by the API route. Page-level consumers only. */
  extras: {
    brain:              BrainOutput;
    salesSnapshot:      NormalizedSalesSnapshot;
    salesProvenance:    DataProvenance;
    inventoryProvenance: DataProvenance;
    dutiesData:         DutiesData | undefined;
    engineOutput:       EvaluateOperationsOutput;
    predictive:         PredictiveSignals;
    feedbackProps:      FeedbackLoopProps;
    revenueConnected:   boolean;
    labourConnected:    boolean;
    microsLiveData:     boolean;
    forecast:           RevenueForecast | null;
    servicePeriod:      string;
    salesAgeMinutes:    number | undefined;
    labourAgeMinutes:   number | undefined;
    inventoryAgeMinutes: number | undefined;
    /** For SecondaryInsights section — display-only, not in score. */
    reviews:            SevenDayReviewSummary;
    maintenance:        MaintenanceSummary;
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildCommandCenterState
 *
 * Single orchestration function for the Command Center.
 *
 * Rule: ONE data fetch → ONE score → ONE state object → many displays.
 *
 * Callers:
 *   - app/dashboard/page.tsx (SSR Server Component)
 *   - app/api/command-center/state/route.ts (JSON API — returns state only)
 */
export async function buildCommandCenterState(
  siteId: string,
  orgId: string | undefined,
): Promise<CommandCenterStateResult> {
  const today_iso = todayISO();

  // ── Step 1: Start brain in parallel (Redis-cached, no extra latency) ──────
  const brainPromise = runOperatingBrain(siteId, today_iso);

  // ── Step 2: Parallel data fetches ────────────────────────────────────────
  const [
    todayResult,
    reviewsResult,
    maintenanceResult,
    eventsResult,
    freshnessResult,
    forecastResult,
    complianceResult,
    microsResult,
    inventoryResult,
  ] = await Promise.allSettled([
    getTodayBookingsSummary(),
    getSevenDayReviewSummary(siteId),
    getMaintenanceSummary(siteId),
    getUpcomingEvents(),
    getDataFreshnessSummary(),
    generateRevenueForecast(today_iso, orgId ?? ""),
    getComplianceSummary(siteId),
    getMicrosStatus(siteId),
    getInventoryIntelligence(siteId),
  ]);

  const { value: today }           = settled(todayResult,       EMPTY_TODAY);
  const { value: reviews }         = settled(reviewsResult,     EMPTY_REVIEWS);
  const { value: maintenance }     = settled(maintenanceResult, EMPTY_MAINTENANCE);
  const { value: events }          = settled(eventsResult,      [] as any[]);
  const { value: freshness }       = settled(freshnessResult,   null);
  const { value: forecast }        = settled(forecastResult,    null as RevenueForecast | null);
  const { value: complianceSummary } = settled(complianceResult, EMPTY_COMPLIANCE);
  const { value: microsStatus }    = settled(microsResult,      null);
  const { value: inventoryIntel }  = settled(inventoryResult,   null);

  // ── Step 3: Labour — resolve via MICROS loc_ref ───────────────────────────
  const msConn = microsStatus as MicrosStatusSummary | null;
  const locRef  = msConn?.connection?.loc_ref ?? null;
  let labourSummary = locRef
    ? await getStoredDailySummary(locRef).catch(() => null)
    : null;
  // Fallback: look back up to 3 days for recent data (handles sync gaps)
  if (locRef && (!labourSummary || (labourSummary.totalLabourHours === 0 && labourSummary.activeStaffCount === 0))) {
    for (let i = 1; i <= 3; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const fb = await getStoredDailySummary(locRef, d.toISOString().split("T")[0]).catch(() => null);
      if (fb && fb.totalLabourHours > 0) { labourSummary = fb; break; }
    }
  }

  // ── Step 4: Sales snapshot (single source of truth for revenue) ───────────
  const ms = microsStatus as MicrosStatusSummary | null;
  const salesSnapshot = await getCurrentSalesSnapshot(
    today_iso, ms, forecast, today.total, today.totalCovers, siteId,
  );
  const salesProvenance = snapshotToProvenance(salesSnapshot, siteId, locRef);

  // ── Step 5: Await brain (started at top — zero extra latency) ────────────
  const brain = await brainPromise.catch(() => null);
  const safeBrain = brain ?? ({
    systemHealth: {
      score: 0, grade: "F", trend: "stable", criticalCount: 0, highCount: 0,
      scoreDrivers: [], allScoreDrivers: [], isDayStarting: false, isDutyWindow: true,
    },
    forecastSummary: { projectedClose: 0, vsTarget: 0, vsSameDayLastYear: null, recoverable: true, recoveryAction: null, isRamadan: false, activeEvent: null, eventUplift: null, isDayClosed: false, syncPending: false, isPreService: false },
    primaryThreat: { title: "Data loading", description: "Refresh in 30 seconds.", severity: "low", modulesInvolved: [], owner: { name: "System", role: "system", userId: "" }, moneyAtRisk: 0, timeWindowMinutes: 0, timeWindowLabel: "", ifIgnored: "", recommendedAction: "", confidence: "low" },
    actionQueue: [],
    doNothingConsequences: [],
    gmSituation: { name: "", score: 0, tier: "Unknown", alertNeeded: false, alertReason: null, hasScoreData: false },
    recoveryMeter: null,
    voiceLine: "Operational data is loading.",
    timestamp: new Date().toISOString(),
    siteId,
  } as any);

  // ── Step 6: POS connection flags (from brain — single source of truth) ────
  const revDriver      = safeBrain.systemHealth.allScoreDrivers.find((d: any) => d.module === "REVENUE");
  const labDriver      = safeBrain.systemHealth.allScoreDrivers.find((d: any) => d.module === "LABOUR");
  const revenueConnected = revDriver?.connected !== false;
  const labourConnected  = labDriver?.connected  !== false;
  const posConnected     = revenueConnected || labourConnected;

  // ── Step 7: Integration health ────────────────────────────────────────────
  const cfgStatus    = getMicrosConfigStatus();
  const microsHealth = deriveMicrosIntegrationStatus(ms, cfgStatus.configured, cfgStatus.enabled);
  const microsLiveData = canUseMicrosLiveData(microsHealth);

  // ── Step 8: Site config ───────────────────────────────────────────────────
  const siteConfig = await getSiteConfig(siteId);

  // ── Step 9: Labour % (canonical calculation with revenue gate) ─────────────
  const rawLabourCost = labourSummary?.totalLabourCost ?? 0;
  const derivedLabourPct =
    rawLabourCost > 0
      ? safeLabourPct(rawLabourCost, salesSnapshot.netSales)
      : null;
  const labourPct = labourSummary?.labourPercentOfSales != null
    ? safeLabourPct(rawLabourCost, salesSnapshot.netSales) ?? labourSummary.labourPercentOfSales
    : derivedLabourPct ?? 0;

  // ── Step 10: Revenue target (single source of truth) ─────────────────────
  const supabase = createServerClient();
  const resolvedTarget = await resolveRevenueTarget(siteId, today_iso, supabase);
  // Use resolved target; fall back to forecast's target if resolvedTarget is null
  const effectiveTarget = resolvedTarget.target ?? salesSnapshot.targetSales ?? 0;

  // ── Step 10b: Revenue variance ────────────────────────────────────────────
  const revenueVariance = effectiveTarget > 0
    ? ((salesSnapshot.netSales - effectiveTarget) / effectiveTarget) * 100
    : 0;

  // ── Step 11: Freshness ages ───────────────────────────────────────────────
  const now = Date.now();
  const salesAgeMinutes    = salesSnapshot.freshnessMinutes ?? undefined;
  const labourAgeMinutes   = labourSummary?.lastSyncAt
    ? Math.round((now - new Date(labourSummary.lastSyncAt).getTime()) / 60_000)
    : undefined;
  const imEnabled = process.env.MICROS_IM_ENABLED === "true";
  const inventoryAgeMinutes = imEnabled && inventoryIntel?.lastSynced
    ? Math.round((now - new Date(inventoryIntel.lastSynced).getTime()) / 60_000)
    : undefined;

  const inventoryProvenance = inventoryToProvenance(inventoryIntel, siteId, imEnabled);

  // ── Step 12: Decision engine — SAME inputs as brain ──────────────────────
  // NOTE: evaluateOperations uses the same revenue/labour values the brain reads.
  //       This guarantees BusinessStatusRail and CommandFeed align with the brain score.
  const engineOutput = evaluateOperations({
    revenue: {
      actual:          salesSnapshot.netSales,
      target:          effectiveTarget,
      variancePercent: revenueVariance,
      covers:          salesSnapshot.covers,
      avgSpend:        salesSnapshot.covers > 0 ? salesSnapshot.netSales / salesSnapshot.covers : 0,
      connected:       revenueConnected,
    },
    labour: {
      labourPercent:  labourPct,
      targetPercent:  siteConfig.target_labour_pct,
      activeStaff:    labourSummary?.activeStaffCount ?? undefined,
      syncAgeMinutes: labourAgeMinutes,
      connected:      labourConnected,
    },
    inventory: {
      criticalCount:  inventoryIntel?.criticalItems.length ?? 0,
      lowCount:       inventoryIntel?.lowItems.length ?? 0,
      noOpenPOCount:  inventoryIntel?.noPOItems.length ?? 0,
      atRiskItems:    inventoryIntel
        ? [...inventoryIntel.criticalItems, ...inventoryIntel.lowItems].slice(0, 5).map((item) => {
            const mi = (inventoryIntel.menuImpact ?? []).find((m) => m.ingredientId === item.id);
            return {
              name:              item.name,
              affectedMenuItems: mi?.affectedDishes,
              severity:          item.risk_level === "critical" ? "critical" as const : "warning" as const,
            };
          })
        : undefined,
      syncAgeMinutes: inventoryAgeMinutes,
    },
    maintenance: {
      openIssues:      maintenance.openRepairs,
      urgentIssues:    maintenance.urgentIssues.length,
      topIssue:        maintenance.topProblemAsset ?? maintenance.urgentIssues[0]?.unit_name ?? undefined,
      serviceBlocking: maintenance.serviceDisruptions > 0,
    },
    compliance: {
      score:              complianceSummary.compliance_pct,
      currentPercent:     complianceSummary.compliance_pct,
      renewalsScheduled:  complianceSummary.scheduled,
      criticalMissing:    complianceSummary.expired,
    },
    forecast: {
      peakWindow:             undefined,
      forecastSales:          forecast?.forecast_sales ?? undefined,
      forecastCovers:         forecast?.forecast_covers ?? undefined,
      actualVsForecastPercent: forecast?.sales_gap_pct != null ? -forecast.sales_gap_pct : undefined,
      confidence:             forecast?.confidence,
      timeToPeakMinutes:      undefined,
    },
    bookings: {
      lunchBookings:  today.total > 0 ? Math.floor(today.total * 0.4) : undefined,
      dinnerBookings: today.total > 0 ? Math.ceil(today.total * 0.6)  : undefined,
    },
    freshness: {
      salesAgeMinutes,
      labourAgeMinutes,
      inventoryAgeMinutes,
    },
  });

  // ── Step 13: Canonical score (from brain — single scorer) ─────────────────
  const canonicalScore = buildCanonicalScore(safeBrain);

  // ── Step 14: Canonical revenue/labour/compliance/maintenance ──────────────
  const revRelibility = revenueReliability(salesSnapshot);
  const gapPct = effectiveTarget > 0 ? revenueVariance : 0;

  const canonicalRevenue: CanonicalRevenue = {
    actual:           salesSnapshot.netSales,
    target:           effectiveTarget,
    projectedClose:   safeBrain.forecastSummary.projectedClose > 0 ? safeBrain.forecastSummary.projectedClose : null,
    gap:              Math.max(effectiveTarget - salesSnapshot.netSales, 0),
    gapPct,
    status:           revenueStatus(gapPct, revRelibility),
    reliability:      revRelibility,
    targetEstimated:  resolvedTarget.estimated,
    targetWarning:    resolvedTarget.warning,
  };

  const labRelibility = labourReliability(labourSummary, revRelibility);
  const canonicalLabour: CanonicalLabour = {
    labourPct,
    targetPct:   siteConfig.target_labour_pct,
    variancePct: labourPct - siteConfig.target_labour_pct,
    status:      labourStatus(labourPct, siteConfig.target_labour_pct, labRelibility),
    reliability: labRelibility,
  };

  const canonicalCompliance: CanonicalCompliance = {
    scorePct:       complianceSummary.compliance_pct,
    compliantCount: complianceSummary.compliant,
    totalCount:     complianceSummary.total,
    expiredCount:   complianceSummary.expired,
    dueSoonCount:   complianceSummary.due_soon,
    status:         complianceStatus(complianceSummary),
  };

  const canonicalMaintenance: CanonicalMaintenance = {
    openItems:    maintenance.openRepairs,
    criticalItems: maintenance.urgentIssues.filter((i) => i.impact_level === "food_safety_risk" || i.impact_level === "service_disruption").length,
    status:       maintenanceStatus(maintenance),
  };

  // ── Step 15: Hero — from brain's primaryThreat ────────────────────────────
  const hero = buildHero(safeBrain, canonicalScore);

  // ── Step 16: Business status — derived from canonical values ─────────────
  const businessStatus = buildBusinessStatus({
    revenue:     canonicalRevenue,
    labour:      canonicalLabour,
    compliance:  canonicalCompliance,
    maintenance: canonicalMaintenance,
    engineStatus: engineOutput.businessStatus,
  });

  // ── Step 17: System Pulse — same score, different presentation ────────────
  const systemPulse = buildSystemPulse(canonicalScore, safeBrain);

  // ── Step 18: Command Feed — from decision engine (same inputs as brain) ───
  const commandFeed = mapCommandFeed(engineOutput.commandFeed);

  // ── Step 19: Service session ──────────────────────────────────────────────
  const serviceSession = buildServiceSession();
  const servicePeriod  = serviceSession.period;

  // ── Step 20: Duties data ──────────────────────────────────────────────────
  const dutiesData = await fetchDutiesData(siteId, new Date().toLocaleDateString("en-CA"));

  // ── Step 21: Predictive signals (for BusinessStatusRail) ─────────────────
  const dutiesDriver  = safeBrain.systemHealth.allScoreDrivers.find((d: any) => d.module === "DUTIES");
  const dutiesCompPct = dutiesDriver ? Math.round((dutiesDriver.pts / 20) * 100) : 100;
  const forecastCovers = forecast?.forecast_covers ?? 0;
  const staffOnFloor   = labourSummary?.activeStaffCount ?? 0;

  const predictive: PredictiveSignals = {
    dinnerRisk: (revenueVariance < -10 && dutiesCompPct < 70) || maintenance.serviceDisruptions > 0 ? "High"
      : (revenueVariance < -5 || dutiesCompPct < 80) ? "Medium" : "Low",
    bookingPace: today.total >= 8 ? "Strong" : today.total >= 3 ? "Moderate" : "Slow",
    peakWindow: "19:00 – 21:00",
    staffingPressure: (staffOnFloor > 0 && forecastCovers > staffOnFloor * 15) ? "High"
      : (staffOnFloor > 0 && forecastCovers > staffOnFloor * 8) ? "Medium" : "Low",
  };

  // ── Step 22: FeedbackLoop props — canonical grade thresholds ─────────────
  // Grade thresholds from canonical spec (A≥85, B≥70, C≥55, D≥40)
  const GRADE_PTS: Record<string, number> = { D: 40, C: 55, B: 70, A: 85 };
  const gradeOrder = ["D", "C", "B", "A"] as const;
  const feedScore   = canonicalScore.value;
  const feedGrade   = canonicalScore.grade;
  const feedNextGrade = gradeOrder.find((g) => feedScore < GRADE_PTS[g]) ?? null;
  const feedPtsToNext = feedNextGrade ? GRADE_PTS[feedNextGrade] - feedScore : 0;

  const feedbackProps: FeedbackLoopProps = {
    score:          feedScore,
    grade:          feedGrade,
    nextGrade:      feedNextGrade,
    ptsToNextGrade: feedPtsToNext,
    tradingTrend:   safeBrain.systemHealth.trend ?? "stable",
    gmTier:         safeBrain.gmSituation.tier ?? "Unknown",
    gmName:         safeBrain.gmSituation.name ?? "",
  };

  // ── Resolve site name ────────────────────────────────────────────────────
  let siteName = siteId;
  try {
    const supabase = createServerClient() as any;
    const { data: siteRow } = await supabase.from("sites").select("name").eq("id", siteId).single();
    if (siteRow?.name) siteName = siteRow.name;
  } catch { /* non-fatal */ }

  // ── Step 23: Operational risk vector (governed risk model) ───────────────
  // This is the new canonical layer — all panels should migrate to reading
  // from here instead of re-deriving risk, severity, or narrative copy.
  const serviceMinutesRemaining = Math.max(0, 480 - serviceSession.minutesElapsed);
  const riskVector = buildOperationalState({
    score:       canonicalScore,
    revenue:     canonicalRevenue,
    labour:      canonicalLabour,
    compliance:  canonicalCompliance,
    maintenance: canonicalMaintenance,
    serviceMinutesRemaining,
    covers:      salesSnapshot.covers,
    projectedClose:
      safeBrain.forecastSummary.projectedClose > 0
        ? safeBrain.forecastSummary.projectedClose
        : null,
    // null until we have ≥30 days of historical service data — NEVER synthesize
    recoveryLikelihood: null,
    forecastConfidence: (forecast?.confidence ?? "low") as ForecastConfidence,
  });

  // ── Compose canonical state ───────────────────────────────────────────────
  const state: CommandCenterState = {
    siteId,
    siteName,
    serviceSession,
    lastSyncAt: new Date().toISOString(),
    score:        canonicalScore,
    revenue:      canonicalRevenue,
    labour:       canonicalLabour,
    compliance:   canonicalCompliance,
    maintenance:  canonicalMaintenance,
    hero,
    businessStatus,
    systemPulse,
    commandFeed,
    riskVector,
  };

  // Persist canonical score — fire-and-forget, never blocks render
  void persistOperatingScore({
    storeId:    siteId,
    scoreDate:  today_iso,
    totalScore: canonicalScore.value,
    grade:      canonicalScore.grade,
    breakdown:  canonicalScore.breakdown as Record<string, unknown>,
  });

  return {
    state,
    extras: {
      brain:               safeBrain,
      salesSnapshot,
      salesProvenance,
      inventoryProvenance,
      dutiesData,
      engineOutput,
      predictive,
      feedbackProps,
      revenueConnected,
      labourConnected,
      microsLiveData,
      forecast,
      servicePeriod,
      salesAgeMinutes,
      labourAgeMinutes,
      inventoryAgeMinutes,
      reviews,
      maintenance,
    },
  };
}
