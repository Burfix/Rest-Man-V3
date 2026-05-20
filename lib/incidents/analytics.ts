/**
 * lib/incidents/analytics.ts
 *
 * Pure, deterministic incident performance analytics engine.
 *
 * No I/O. No side effects. All functions accept an optional `now` epoch (ms)
 * parameter so tests can pass a fixed timestamp for fully deterministic results.
 *
 * Covers:
 *   - SLA breach trends (daily bucketing)
 *   - MTTR trends (weekly bucketing)
 *   - Acknowledgement latency by site (avg, p50, p90)
 *   - Repeat offenders by source
 *   - Unresolved aging heatmap
 *   - Operator workload (assigned-to grouping)
 *   - Escalation trend (daily bucketing by level)
 *   - 7-day executive summary
 */

import {
  calculateTimeToAcknowledge,
  calculateTimeToResolve,
  SLA_THRESHOLDS,
} from "./sla";

// ── Input type ─────────────────────────────────────────────────────────────────

export interface IncidentForAnalytics {
  id:              string;
  siteId:          string | null;
  source:          string;
  severity:        "info" | "warning" | "critical";
  status:          string;
  createdAt:       string;
  resolvedAt:      string | null;
  acknowledgedAt:  string | null;
  assignedTo:      string | null;
  escalationLevel: "normal" | "elevated" | "urgent";
}

// ── Output types ───────────────────────────────────────────────────────────────

export interface SlaBreachPoint {
  date:               string;  // ISO date YYYY-MM-DD (creation date)
  total:              number;
  ackBreached:        number;
  resolutionBreached: number;
  uniqueBreached:     number;  // incidents breaching either SLA
  complianceRate:     number;  // 0–100 (1 decimal)
}

export interface MttrTrendPoint {
  weekStart:      string;  // ISO date of week-start Monday
  avgMttrMinutes: number;
  resolvedCount:  number;
}

export interface AckLatencyEntry {
  siteId:        string;
  siteName:      string;
  avgAckMinutes: number;
  p50AckMinutes: number;
  p90AckMinutes: number;
  incidentCount: number;
}

export interface RepeatOffender {
  source:           string;
  incidentCount:    number;
  criticalCount:    number;
  avgIntervalHours: number | null;
  lastSeenAt:       string;
}

export interface AgingBucket {
  label:      string;
  minMinutes: number;
  maxMinutes: number;
  critical:   number;
  warning:    number;
  info:       number;
  total:      number;
}

export interface OperatorWorkload {
  userId:         string;
  openCount:      number;
  resolvedCount:  number;
  avgMttrMinutes: number | null;
  escalatedCount: number;
}

export interface EscalationTrendPoint {
  date:          string;
  normalCount:   number;
  elevatedCount: number;
  urgentCount:   number;
}

export interface WeeklySummary {
  periodStart:       string;
  periodEnd:         string;
  totalIncidents:    number;
  resolvedCount:     number;
  openCount:         number;
  slaComplianceRate: number;
  avgMttrMinutes:    number | null;
  criticalOpenCount: number;
  escalatedCount:    number;
  worstSite:         { siteId: string; siteName: string; incidentCount: number } | null;
  worstSource:       { source: string; incidentCount: number } | null;
  mttrBySite:        Array<{ siteId: string; siteName: string; avgMttrMinutes: number; incidentCount: number }>;
  topRepeatOffenders: Array<{ source: string; incidentCount: number; criticalCount: number }>;
  slaBreachDetails:  {
    ackBreachedCount:        number;
    resolutionBreachedCount: number;
    uniqueBreachedCount:     number;
  };
}

export interface PerformanceMetrics {
  periodDays:       number;
  breachTrend:      SlaBreachPoint[];
  mttrTrend:        MttrTrendPoint[];
  ackLatencyBySite: AckLatencyEntry[];
  repeatOffenders:  RepeatOffender[];
  agingBuckets:     AgingBucket[];
  operatorWorkload: OperatorWorkload[];
  escalationTrend:  EscalationTrendPoint[];
  weeklySummary:    WeeklySummary;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Nearest previous Monday (ISO week start). */
function toWeekStart(iso: string): string {
  const d    = new Date(iso);
  const dow  = d.getUTCDay();            // 0 = Sun
  const diff = dow === 0 ? 6 : dow - 1; // days since Monday
  return toDateStr(d.getTime() - diff * 86_400_000);
}

/** p-th percentile (0..1) of a pre-sorted ascending array. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Historical ack-breach check.
 *
 * For resolved incidents: was ack threshold exceeded before resolution?
 * For active incidents: is ack threshold exceeded at `now`?
 */
function wasAckBreached(inc: IncidentForAnalytics, now: number): boolean {
  const threshold = SLA_THRESHOLDS[inc.severity];
  if (inc.acknowledgedAt) {
    const tta = calculateTimeToAcknowledge({
      createdAt:      inc.createdAt,
      acknowledgedAt: inc.acknowledgedAt,
    }) ?? 0;
    return tta > threshold.ackMinutes;
  }
  const referenceMs = (inc.status === "resolved" && inc.resolvedAt)
    ? new Date(inc.resolvedAt).getTime()
    : now;
  return (referenceMs - new Date(inc.createdAt).getTime()) / 60_000 > threshold.ackMinutes;
}

/**
 * Historical resolution-breach check.
 *
 * For resolved incidents: was resolve threshold exceeded?
 * For active incidents: has resolve threshold been exceeded at `now`?
 */
function wasResolutionBreached(inc: IncidentForAnalytics, now: number): boolean {
  const threshold = SLA_THRESHOLDS[inc.severity];
  if (inc.status === "resolved" && inc.resolvedAt) {
    const mttr = calculateTimeToResolve({
      createdAt:  inc.createdAt,
      resolvedAt: inc.resolvedAt,
    }) ?? 0;
    return mttr > threshold.resolveMinutes;
  }
  return (now - new Date(inc.createdAt).getTime()) / 60_000 > threshold.resolveMinutes;
}

// ── Aging bucket definitions ───────────────────────────────────────────────────

const AGING_BUCKET_DEFS: Array<{ label: string; minMinutes: number; maxMinutes: number }> = [
  { label: "< 1 hour",    minMinutes:    0, maxMinutes:    60 },
  { label: "1 – 4 hrs",  minMinutes:   60, maxMinutes:   240 },
  { label: "4 – 8 hrs",  minMinutes:  240, maxMinutes:   480 },
  { label: "8 – 24 hrs", minMinutes:  480, maxMinutes:  1440 },
  { label: "> 24 hours", minMinutes: 1440, maxMinutes: Infinity },
];

// ── Public compute functions ───────────────────────────────────────────────────

/**
 * Daily SLA breach trend.
 * Each point covers incidents created on that calendar day.
 */
export function computeSlaBreachTrend(
  incidents: IncidentForAnalytics[],
  days: number,
  now: number = Date.now(),
): SlaBreachPoint[] {
  const cutoff  = now - days * 86_400_000;
  const buckets = new Map<
    string,
    { total: number; ackBreached: number; resolutionBreached: number; uniqueBreached: number }
  >();

  for (let i = days - 1; i >= 0; i--) {
    buckets.set(toDateStr(now - i * 86_400_000), {
      total: 0, ackBreached: 0, resolutionBreached: 0, uniqueBreached: 0,
    });
  }

  for (const inc of incidents) {
    const createdMs = new Date(inc.createdAt).getTime();
    if (createdMs < cutoff) continue;
    const b = buckets.get(toDateStr(createdMs));
    if (!b) continue;
    b.total++;
    const ab = wasAckBreached(inc, now);
    const rb = wasResolutionBreached(inc, now);
    if (ab) b.ackBreached++;
    if (rb) b.resolutionBreached++;
    if (ab || rb) b.uniqueBreached++;
  }

  return [...buckets.entries()].map(([date, b]) => ({
    date,
    total:              b.total,
    ackBreached:        b.ackBreached,
    resolutionBreached: b.resolutionBreached,
    uniqueBreached:     b.uniqueBreached,
    complianceRate:     b.total === 0
      ? 100
      : Math.round(((b.total - b.uniqueBreached) / b.total) * 1000) / 10,
  }));
}

/**
 * Weekly MTTR trend.
 * Groups resolved incidents by the calendar week they were resolved.
 */
export function computeMttrTrend(
  incidents: IncidentForAnalytics[],
  days: number,
  now: number = Date.now(),
): MttrTrendPoint[] {
  const cutoff  = now - days * 86_400_000;
  const byWeek  = new Map<string, number[]>();

  for (const inc of incidents) {
    if (inc.status !== "resolved" || !inc.resolvedAt) continue;
    const resolvedMs = new Date(inc.resolvedAt).getTime();
    if (resolvedMs < cutoff || resolvedMs > now) continue;
    const mttr = calculateTimeToResolve({ createdAt: inc.createdAt, resolvedAt: inc.resolvedAt }) ?? 0;
    const week = toWeekStart(inc.resolvedAt);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(mttr);
  }

  return [...byWeek.entries()]
    .map(([weekStart, times]) => ({
      weekStart,
      avgMttrMinutes: avg(times) ?? 0,
      resolvedCount:  times.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Ack latency (avg, p50, p90) grouped by site, sorted slowest-first.
 * Only includes incidents with a recorded acknowledgedAt and a known siteId.
 */
export function computeAckLatencyBySite(
  incidents: IncidentForAnalytics[],
  siteNameMap: Map<string, string>,
): AckLatencyEntry[] {
  const bySite = new Map<string, number[]>();

  for (const inc of incidents) {
    if (!inc.acknowledgedAt || !inc.siteId) continue;
    const tta = calculateTimeToAcknowledge({
      createdAt:      inc.createdAt,
      acknowledgedAt: inc.acknowledgedAt,
    });
    if (tta === null) continue;
    if (!bySite.has(inc.siteId)) bySite.set(inc.siteId, []);
    bySite.get(inc.siteId)!.push(tta);
  }

  return [...bySite.entries()]
    .map(([siteId, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return {
        siteId,
        siteName:      siteNameMap.get(siteId) ?? siteId,
        avgAckMinutes: avg(times) ?? 0,
        p50AckMinutes: Math.round(pct(sorted, 0.5)),
        p90AckMinutes: Math.round(pct(sorted, 0.9)),
        incidentCount: times.length,
      };
    })
    .sort((a, b) => b.avgAckMinutes - a.avgAckMinutes);
}

/**
 * Sources that have fired multiple incidents, sorted by count descending.
 * avgIntervalHours is the mean time between consecutive fires.
 */
export function computeRepeatOffenders(
  incidents: IncidentForAnalytics[],
  minCount: number = 2,
): RepeatOffender[] {
  const bySource = new Map<string, IncidentForAnalytics[]>();

  for (const inc of incidents) {
    if (!bySource.has(inc.source)) bySource.set(inc.source, []);
    bySource.get(inc.source)!.push(inc);
  }

  const result: RepeatOffender[] = [];
  for (const [source, incs] of bySource.entries()) {
    if (incs.length < minCount) continue;
    const sorted = [...incs].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(
        (new Date(sorted[i].createdAt).getTime() - new Date(sorted[i - 1].createdAt).getTime()) / 3_600_000,
      );
    }
    result.push({
      source,
      incidentCount:    incs.length,
      criticalCount:    incs.filter(i => i.severity === "critical").length,
      avgIntervalHours: intervals.length > 0
        ? Math.round((intervals.reduce((a, b) => a + b, 0) / intervals.length) * 10) / 10
        : null,
      lastSeenAt: sorted[sorted.length - 1].createdAt,
    });
  }

  return result.sort((a, b) => b.incidentCount - a.incidentCount);
}

/**
 * Age × severity heatmap for currently active (unresolved) incidents.
 */
export function computeAgingBuckets(
  incidents: IncidentForAnalytics[],
  now: number = Date.now(),
): AgingBucket[] {
  const active = incidents.filter(i => i.status !== "resolved");
  return AGING_BUCKET_DEFS.map(def => {
    const inBucket = active.filter(i => {
      const age = (now - new Date(i.createdAt).getTime()) / 60_000;
      return age >= def.minMinutes && age < def.maxMinutes;
    });
    return {
      ...def,
      critical: inBucket.filter(i => i.severity === "critical").length,
      warning:  inBucket.filter(i => i.severity === "warning").length,
      info:     inBucket.filter(i => i.severity === "info").length,
      total:    inBucket.length,
    };
  });
}

/**
 * Per-operator incident load for all incidents with an assigned_to value.
 * Sorted by open count descending.
 */
export function computeOperatorWorkload(
  incidents: IncidentForAnalytics[],
): OperatorWorkload[] {
  const byOp = new Map<string, IncidentForAnalytics[]>();

  for (const inc of incidents) {
    if (!inc.assignedTo) continue;
    if (!byOp.has(inc.assignedTo)) byOp.set(inc.assignedTo, []);
    byOp.get(inc.assignedTo)!.push(inc);
  }

  return [...byOp.entries()]
    .map(([userId, incs]) => {
      const resolved   = incs.filter(i => i.status === "resolved" && i.resolvedAt);
      const mttrValues = resolved.map(
        i => calculateTimeToResolve({ createdAt: i.createdAt, resolvedAt: i.resolvedAt }) ?? 0,
      );
      return {
        userId,
        openCount:      incs.filter(i => i.status !== "resolved").length,
        resolvedCount:  resolved.length,
        avgMttrMinutes: avg(mttrValues),
        escalatedCount: incs.filter(i => i.escalationLevel !== "normal").length,
      };
    })
    .sort((a, b) => b.openCount - a.openCount || b.resolvedCount - a.resolvedCount);
}

/**
 * Daily escalation level distribution, bucketed by creation date.
 * Shows how many incidents per day ended up at each escalation tier.
 */
export function computeEscalationTrend(
  incidents: IncidentForAnalytics[],
  days: number,
  now: number = Date.now(),
): EscalationTrendPoint[] {
  const cutoff  = now - days * 86_400_000;
  const buckets = new Map<
    string,
    { normalCount: number; elevatedCount: number; urgentCount: number }
  >();

  for (let i = days - 1; i >= 0; i--) {
    buckets.set(toDateStr(now - i * 86_400_000), {
      normalCount: 0, elevatedCount: 0, urgentCount: 0,
    });
  }

  for (const inc of incidents) {
    const createdMs = new Date(inc.createdAt).getTime();
    if (createdMs < cutoff) continue;
    const b = buckets.get(toDateStr(createdMs));
    if (!b) continue;
    if      (inc.escalationLevel === "urgent")   b.urgentCount++;
    else if (inc.escalationLevel === "elevated") b.elevatedCount++;
    else                                          b.normalCount++;
  }

  return [...buckets.entries()].map(([date, b]) => ({ date, ...b }));
}

/**
 * 7-day executive summary.
 * Filters to incidents created in the last 7 days relative to `now`.
 */
export function computeWeeklySummary(
  incidents: IncidentForAnalytics[],
  siteNameMap: Map<string, string>,
  now: number = Date.now(),
): WeeklySummary {
  const weekAgo = now - 7 * 86_400_000;
  const weekly  = incidents.filter(i => new Date(i.createdAt).getTime() >= weekAgo);

  const resolved  = weekly.filter(i => i.status === "resolved" && i.resolvedAt);
  const open      = weekly.filter(i => i.status !== "resolved");
  const escalated = weekly.filter(i => i.escalationLevel !== "normal");

  const mttrValues = resolved.map(
    i => calculateTimeToResolve({ createdAt: i.createdAt, resolvedAt: i.resolvedAt }) ?? 0,
  );

  // SLA breach counts
  const ackBreachedIncs        = weekly.filter(i => wasAckBreached(i, now));
  const resolutionBreachedIncs = weekly.filter(i => wasResolutionBreached(i, now));
  const uniqueBreached         = new Set([
    ...ackBreachedIncs.map(i => i.id),
    ...resolutionBreachedIncs.map(i => i.id),
  ]);

  // Worst site
  const bySite = new Map<string, number>();
  for (const inc of weekly) {
    if (!inc.siteId) continue;
    bySite.set(inc.siteId, (bySite.get(inc.siteId) ?? 0) + 1);
  }
  let worstSite: WeeklySummary["worstSite"] = null;
  for (const [siteId, count] of bySite.entries()) {
    if (!worstSite || count > worstSite.incidentCount) {
      worstSite = { siteId, siteName: siteNameMap.get(siteId) ?? siteId, incidentCount: count };
    }
  }

  // Worst source
  const bySource = new Map<string, number>();
  for (const inc of weekly) bySource.set(inc.source, (bySource.get(inc.source) ?? 0) + 1);
  let worstSource: WeeklySummary["worstSource"] = null;
  for (const [source, count] of bySource.entries()) {
    if (!worstSource || count > worstSource.incidentCount) {
      worstSource = { source, incidentCount: count };
    }
  }

  // MTTR by site
  const mttrBySiteMap = new Map<string, number[]>();
  for (const inc of resolved) {
    if (!inc.siteId) continue;
    const mttr = calculateTimeToResolve({ createdAt: inc.createdAt, resolvedAt: inc.resolvedAt }) ?? 0;
    if (!mttrBySiteMap.has(inc.siteId)) mttrBySiteMap.set(inc.siteId, []);
    mttrBySiteMap.get(inc.siteId)!.push(mttr);
  }
  const mttrBySite = [...mttrBySiteMap.entries()]
    .map(([siteId, times]) => ({
      siteId,
      siteName:       siteNameMap.get(siteId) ?? siteId,
      avgMttrMinutes: avg(times) ?? 0,
      incidentCount:  times.length,
    }))
    .sort((a, b) => b.avgMttrMinutes - a.avgMttrMinutes);

  return {
    periodStart:       new Date(weekAgo).toISOString(),
    periodEnd:         new Date(now).toISOString(),
    totalIncidents:    weekly.length,
    resolvedCount:     resolved.length,
    openCount:         open.length,
    slaComplianceRate: weekly.length === 0
      ? 100
      : Math.round(((weekly.length - uniqueBreached.size) / weekly.length) * 1000) / 10,
    avgMttrMinutes:    avg(mttrValues),
    criticalOpenCount: open.filter(i => i.severity === "critical").length,
    escalatedCount:    escalated.length,
    worstSite,
    worstSource,
    mttrBySite,
    topRepeatOffenders: computeRepeatOffenders(weekly, 2)
      .slice(0, 5)
      .map(r => ({ source: r.source, incidentCount: r.incidentCount, criticalCount: r.criticalCount })),
    slaBreachDetails: {
      ackBreachedCount:        ackBreachedIncs.length,
      resolutionBreachedCount: resolutionBreachedIncs.length,
      uniqueBreachedCount:     uniqueBreached.size,
    },
  };
}

/**
 * Top-level aggregator — call once per API response.
 * Passes the same incident array to all sub-functions.
 */
export function computePerformanceMetrics(
  incidents: IncidentForAnalytics[],
  siteNameMap: Map<string, string>,
  days: number,
  now: number = Date.now(),
): PerformanceMetrics {
  return {
    periodDays:       days,
    breachTrend:      computeSlaBreachTrend(incidents, days, now),
    mttrTrend:        computeMttrTrend(incidents, days, now),
    ackLatencyBySite: computeAckLatencyBySite(incidents, siteNameMap),
    repeatOffenders:  computeRepeatOffenders(incidents),
    agingBuckets:     computeAgingBuckets(incidents, now),
    operatorWorkload: computeOperatorWorkload(incidents),
    escalationTrend:  computeEscalationTrend(incidents, days, now),
    weeklySummary:    computeWeeklySummary(incidents, siteNameMap, now),
  };
}
