/**
 * Command Center utilities
 *
 * buildPriorityActions — derives top manager actions from live data
 * computeHealthScore   — Restaurant Health Score (0–100) with breakdown
 * getServicePeriod     — returns current service period label
 */

import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  DailyOperationsDashboardSummary,
  SevenDayReviewSummary,
  VenueEvent,
} from "@/types";

// ── Action types ─────────────────────────────────────────────────────────────

export type ActionSeverity = "critical" | "urgent" | "action" | "watch";
export type ActionCategory =
  | "compliance"
  | "maintenance"
  | "revenue"
  | "staffing"
  | "events"
  | "data";

export interface ActionButton {
  label: string;
  href:  string;
}

export type ImpactWeight = "blocker" | "required_today" | "high_impact" | "quick_win" | "monitor";

export const IMPACT_LABELS: Record<ImpactWeight, string> = {
  blocker:        "BLOCKER",
  required_today: "REQUIRED TODAY",
  high_impact:    "HIGH IMPACT",
  quick_win:      "QUICK WIN",
  monitor:        "MONITOR",
};

export interface DashboardAction {
  severity:         ActionSeverity;
  category:         ActionCategory;
  title:            string;
  message:          string;
  recommendation:   string;
  href:             string;
  /** Primary inline CTA (replaces generic "View →") */
  primaryAction?:   ActionButton;
  /** Up to 2 secondary actions for overflow menu */
  secondaryActions?: ActionButton[];
  /** Impact weight tag — helps GM prioritise at a glance */
  impactWeight?:    ImpactWeight;
  impactLabel?:     string;
  /** HIGH RISK banner — shown above action list */
  isHighRisk?:      boolean;
  /** Specific recovery target — e.g. "Need +12 covers at R450 avg" */
  recoveryMetric?:  string;
  /** Minutes remaining in current service window. Drives urgency countdown. */
  serviceWindowMinutes?: number;
  /** Compliance items attached to this action (for inline scheduling) */
  complianceItems?: Array<{
    id: string;
    display_name: string;
    next_due_date: string | null;
    scheduled_service_date?: string | null;
    scheduled_with?: string | null;
  }>;
}

// ── Command Headline ──────────────────────────────────────────────────────────

export type HeadlineSeverity = "good" | "warning" | "urgent";

export interface CommandHeadline {
  severity:      HeadlineSeverity;
  text:          string;    // Short operator insight, e.g. "Behind target — push walk-ins before 18:00"
  subtext?:      string;    // Optional supporting detail
  timePressure?: string;    // Time-bound phrase woven into text, stored for reference
}

// ── Time & Period Helpers ─────────────────────────────────────────────────────

/** Current hour in Africa/Johannesburg (0–23) */
function getSASTHour(): number {
  const s = new Date().toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour:     "numeric",
    hour12:   false,
  });
  const h = parseInt(s, 10);
  return isNaN(h) ? new Date().getHours() : h;
}

/**
 * Returns an operator-friendly timing phrase based on current SAST hour
 * and the context of what the GM needs to act on.
 */
export function getTimePressurePhrase(
  context: "revenue_behind" | "labour_high" | "walk_ins" | "on_track"
): string {
  const h = getSASTHour();
  if (context === "revenue_behind") {
    if (h < 12) return "before lunch service";
    if (h < 15) return "over lunch and into dinner";
    if (h < 17) return "before dinner service";
    if (h < 19) return "before 20:00";
    if (h < 21) return "before close";
    return "tonight";
  }
  if (context === "labour_high") {
    if (h < 15) return "by 17:00";
    if (h < 18) return "before dinner peak";
    if (h < 21) return "before close";
    return "at close";
  }
  if (context === "walk_ins") {
    if (h < 18) return "over the next 2 hours";
    if (h < 21) return "during dinner service";
    return "tonight";
  }
  if (context === "on_track") {
    if (h < 12) return "through lunch service";
    if (h < 17) return "into dinner service";
    if (h < 20) return "through dinner service";
    return "through close";
  }
  return "before close";
}

// ── Trend Signals ─────────────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "flat";
export type TrendTone      = "positive" | "negative" | "neutral";

export interface TrendSignal {
  direction: TrendDirection;
  tone:      TrendTone;
  label:     string;
}

/**
 * Revenue trend — derived from forecast gap vs target.
 * Only returned when confidence is medium or high.
 */
export function computeRevenueTrend(forecast: RevenueForecast | null): TrendSignal | null {
  if (!forecast || forecast.confidence === "low" || forecast.sales_gap_pct == null) return null;
  const g = forecast.sales_gap_pct;
  if (g > 5)    return { direction: "up",   tone: "positive", label: "improving" };
  if (g >= -5)  return { direction: "flat", tone: "neutral",  label: "stable" };
  if (g >= -15) return { direction: "down", tone: "negative", label: "slowing" };
  return { direction: "down", tone: "negative", label: "behind" };
}

/**
 * Labour trend — derived from current labour % vs target band (18–30%).
 * Tone is context-sensitive: labour ↓ is positive if previously high.
 */
export function computeLabourTrend(laborPct: number | null): TrendSignal | null {
  if (laborPct == null) return null;
  const TARGET_MAX = 30;
  const TARGET_MIN = 18;
  if (laborPct > TARGET_MAX + 10) return { direction: "up",   tone: "negative", label: "rising" };
  if (laborPct > TARGET_MAX)      return { direction: "up",   tone: "negative", label: "elevated" };
  if (laborPct >= TARGET_MIN)     return { direction: "flat", tone: "neutral",  label: "steady" };
  return { direction: "down", tone: "positive", label: "easing" };
}

// ── Confidence Summary ────────────────────────────────────────────────────────

export interface ConfidenceSummary {
  level:  "high" | "medium" | "low";
  detail: string; // e.g. "Sales 3m · Labour 10m"
}

export function generateConfidenceSummary(params: {
  microsStatus?: {
    isConfigured:        boolean;
    isLiveDataAvailable?: boolean;
    minutesSinceSync:    number | null;
    lastSyncError?:      string | null;
  } | null;
  dailyOps: DailyOperationsDashboardSummary;
  today:    string; // YYYY-MM-DD
}): ConfidenceSummary {
  const { microsStatus, dailyOps, today } = params;
  const ms = microsStatus;

  // Live POS + fresh (< 15 min) — only when isLiveDataAvailable is verified
  if (
    ms?.isLiveDataAvailable === true &&
    ms.minutesSinceSync != null &&
    ms.minutesSinceSync < 15
  ) {
    const age = ms.minutesSinceSync < 1 ? "now" : `${ms.minutesSinceSync}m`;
    const labourDetail = dailyOps.latestReport ? "Labour live" : "Labour pending";
    return { level: "high", detail: `Sales ${age} · ${labourDetail}` };
  }

  // MICROS configured but not live (error / stale)
  if (ms?.isConfigured && !ms.isLiveDataAvailable && ms.lastSyncError) {
    return { level: "low", detail: "POS feed unavailable — using saved values" };
  }
  if (ms?.isConfigured && !ms.isLiveDataAvailable && (ms.minutesSinceSync == null || ms.minutesSinceSync >= 60)) {
    const h = ms.minutesSinceSync != null ? Math.floor(ms.minutesSinceSync / 60) : null;
    return { level: "low", detail: h ? `POS sync stale — ${h}h ago` : "POS sync stale" };
  }
  if (ms?.isLiveDataAvailable === true && ms.minutesSinceSync != null && ms.minutesSinceSync < 60) {
    const age = `${ms.minutesSinceSync}m`;
    return { level: "medium", detail: `Sales ${age} · Labour from CSV` };
  }

  // Manual / CSV upload path
  if (dailyOps.latestReport) {
    const ageDays = Math.floor(
      (new Date(today + "T12:00:00Z").getTime() -
        new Date((dailyOps.latestReport.report_date ?? today) + "T12:00:00Z").getTime()) /
        86_400_000
    );
    if (ageDays <= 1) {
      return { level: "medium", detail: `Manual mode · Report ${ageDays === 0 ? "today" : "yesterday"}` };
    }
    return { level: "low", detail: `Manual mode · Report ${ageDays}d ago` };
  }

  return { level: "low", detail: "Awaiting data — upload required" };
}

// ── Two-Hour Outlook ──────────────────────────────────────────────────────────

export interface TwoHourOutlook {
  text:       string;
  confidence: "high" | "medium" | "low" | "none";
}

export function generateTwoHourOutlook(params: {
  forecast:      RevenueForecast | null;
  dailyOps:      DailyOperationsDashboardSummary;
  today:         { total: number; totalCovers: number };
  servicePeriod: string;
}): TwoHourOutlook {
  const { forecast, dailyOps, today } = params;
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;

  if (!forecast) {
    return { text: "Limited live data — manual check required", confidence: "none" };
  }

  const gapAbs      = forecast.sales_gap ?? null;
  const gapPct      = forecast.sales_gap_pct ?? null;
  const extraCovers = forecast.required_extra_covers;
  const avgSpend    = Math.round(forecast.forecast_avg_spend);
  const walkPhrase  = getTimePressurePhrase("walk_ins");

  // Revenue well behind
  if (gapAbs != null && gapAbs < -500 && extraCovers > 0 && avgSpend > 0) {
    const gapStr = `R${Math.abs(Math.round(gapAbs)).toLocaleString()}`;
    return {
      text: `Projected shortfall ${gapStr} — needs +${extraCovers} cover${extraCovers > 1 ? "s" : ""} at R${avgSpend} avg spend`,
      confidence: forecast.confidence,
    };
  }
  if (gapAbs != null && gapAbs < -200) {
    const gapStr = `R${Math.abs(Math.round(gapAbs)).toLocaleString()}`;
    return {
      text: `Revenue ${gapStr} short — walk-in focus needed ${walkPhrase}`,
      confidence: forecast.confidence,
    };
  }

  // Labour pressure
  if (laborPct != null && laborPct > 45) {
    const pressureEnd = getTimePressurePhrase("labour_high");
    return {
      text: `Labour pressure continues — remains above target ${pressureEnd} unless coverage reduced`,
      confidence: "medium",
    };
  }

  // On track with bookings
  if (gapPct != null && gapPct >= -5 && today.totalCovers > 0) {
    return {
      text: `On pace for target — ${today.totalCovers} covers confirmed, walk-ins will secure the close`,
      confidence: forecast.confidence,
    };
  }
  if (gapPct != null && gapPct >= -5) {
    return {
      text: `Revenue on track if walk-in conversion holds ${getTimePressurePhrase("on_track")}`,
      confidence: forecast.confidence,
    };
  }

  // Moderate shortfall
  if (gapPct != null && gapPct < -5) {
    return {
      text: `Revenue at risk — walk-in focus ${walkPhrase} required to recover`,
      confidence: forecast.confidence,
    };
  }

  return { text: "No material deviations at current pace — stay alert through close", confidence: "medium" };
}

/**
 * Derives a single decisive GM headline from live operational signals.
 * Reads like an operator insight, not a data report.
 */
export function generateCommandHeadline(params: {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  dailyOps:    DailyOperationsDashboardSummary;
  today:       { total: number; totalCovers: number };
  servicePeriod: string;
}): CommandHeadline {
  const { compliance, maintenance, forecast, dailyOps, today, servicePeriod } = params;
  const laborPct     = dailyOps.latestReport?.labor_cost_percent ?? null;
  const gapPct       = forecast?.sales_gap_pct ?? null;
  const gapAbs       = forecast?.sales_gap     ?? null;

  const labourHigh    = laborPct != null && laborPct > 45;
  const labourRisk    = laborPct != null && laborPct > 35 && laborPct <= 45;
  const revBehind     = gapPct != null && gapPct < -10;
  const revWellBehind = gapPct != null && gapPct < -20;
  const revOnTrack    = gapPct != null && gapPct >= -5;
  const revAhead      = gapPct != null && gapPct >= 5;

  // ── Critical safety / compliance blocks first ──────────────────────────
  if (maintenance.foodSafetyRisks > 0) {
    const tp = `before ${servicePeriod === "Dinner" || servicePeriod === "After Hours" ? "close" : "service"}`;
    return {
      severity:     "urgent",
      text:         `Food safety risk — immediate action required ${tp}`,
      subtext:      `${maintenance.foodSafetyRisks} unresolved issue${maintenance.foodSafetyRisks > 1 ? "s" : ""} — resolve now to protect service continuity`,
      timePressure: tp,
    };
  }
  if (compliance.expired > 0) {
    return {
      severity:     "urgent",
      text:         `${compliance.expired} compliance certificate${compliance.expired > 1 ? "s" : ""} expired — legal risk active today`,
      subtext:      "Operating without valid certificates. Upload renewals immediately.",
      timePressure: "today",
    };
  }
  if (maintenance.serviceDisruptions > 0) {
    const issue = maintenance.urgentIssues.find((i) => i.impact_level === "service_disruption");
    const tp    = `before ${servicePeriod === "Dinner" ? "dinner service" : "next service"}`;
    return {
      severity:     "urgent",
      text:         `Service disruption — ${issue ? issue.unit_name : "equipment"} issue requires fix ${tp}`,
      subtext:      "Resolve before next service period to protect guest experience.",
      timePressure: tp,
    };
  }

  // ── Revenue + labour headline ──────────────────────────────────────────

  // Both bad
  if (revWellBehind && labourHigh) {
    const gap = gapAbs != null ? `R${Math.abs(Math.round(gapAbs)).toLocaleString()}` : "";
    const tp  = getTimePressurePhrase("revenue_behind");
    return {
      severity:     "urgent",
      text:         gap
        ? `Revenue ${gap} short and labour high — high-risk close ${tp}`
        : `Revenue weak and labour high — high-risk close ${tp}`,
      subtext:      "Reduce one FOH position and push walk-ins aggressively.",
      timePressure: tp,
    };
  }

  // Revenue well behind
  if (revWellBehind) {
    const gap = gapAbs != null ? `R${Math.abs(Math.round(gapAbs)).toLocaleString()}` : "";
    const tp  = getTimePressurePhrase("revenue_behind");
    return {
      severity:     "urgent",
      text:         gap
        ? `Behind target — requires ${gap} walk-in recovery ${tp}`
        : `Significantly behind revenue target ${tp}`,
      subtext:      "Trigger a walk-in promotion and ensure floor staff are upselling.",
      timePressure: tp,
    };
  }

  if (revBehind) {
    const gap = gapAbs != null ? `R${Math.abs(Math.round(gapAbs)).toLocaleString()}` : "";
    const tp  = getTimePressurePhrase("revenue_behind");
    return {
      severity:     "warning",
      text:         gap
        ? `Behind target — ${gap} gap to close ${tp}`
        : `Below revenue target — focus ${tp}`,
      subtext:      "Confirm all bookings, prioritise upsell on covers.",
      timePressure: tp,
    };
  }

  // Labour risk
  if (labourHigh) {
    const tp = getTimePressurePhrase("labour_high");
    return {
      severity:     "warning",
      text:         `Labour running high at ${laborPct?.toFixed(1)}% — reduce staffing ${tp}`,
      subtext:      "Current labour cost will pressure margin close. Review shift coverage now.",
      timePressure: tp,
    };
  }
  if (labourRisk) {
    const tp = getTimePressurePhrase("labour_high");
    return {
      severity:     "warning",
      text:         `Labour elevated at ${laborPct?.toFixed(1)}% — requires attention`,
      subtext:      `Above target range. No new shifts ${tp}.`,
      timePressure: tp,
    };
  }

  // On track + good bookings
  if (revAhead && today.total > 0) {
    const tp = getTimePressurePhrase("on_track");
    return {
      severity:     "good",
      text:         `Ahead of target — strong booking position ${tp}`,
      subtext:      `${today.totalCovers} covers confirmed. Focus on quality of service and upsell.`,
      timePressure: tp,
    };
  }
  if (revOnTrack && today.total > 0) {
    const tp = getTimePressurePhrase("on_track");
    return {
      severity:     "good",
      text:         `On track for revenue target — maintain pace ${tp}`,
      subtext:      `${today.totalCovers} covers confirmed. Confirm all pending bookings and maintain upsell.`,
      timePressure: tp,
    };
  }
  if (revOnTrack) {
    const tp = getTimePressurePhrase("walk_ins");
    return {
      severity:     "good",
      text:         `Revenue on track — walk-ins and upsell will secure the close`,
      subtext:      `Floor should be ready for walk-in traffic ${tp}.`,
      timePressure: tp,
    };
  }

  // No forecast data
  if (!forecast) {
    if (maintenance.openRepairs > 0 || compliance.due_soon > 0) {
      return {
        severity: "warning",
        text:     "Operational items require attention before service",
        subtext:  "Review maintenance and any unscheduled compliance items before the service period begins.",
      };
    }
    return {
      severity: "warning",
      text:     "Awaiting live data — upload daily ops or connect MICROS for full intelligence",
      subtext:  "Revenue and labour data not yet available for today.",
    };
  }

  // Default stable
  return {
    severity: "good",
    text:     "Operations stable — maintain pace through service",
    subtext:  "No critical alerts. Review all sections before pre-shift briefing.",
  };
}

// ── Labour Intelligence ───────────────────────────────────────────────────────

export interface LabourInsight {
  pct:               number;
  status:            "efficient" | "healthy" | "elevated" | "high" | "critical";
  label:             string;
  interpretation:    string;
  projectedClose?:   number | null;
  recommendation?:   string;
  targetMin:         number;
  targetMax:         number;
}

/**
 * Produces an interpreted labour insight with target ranges and recommendation.
 * Labour targets: 18–30% for full-service restaurant (conservative for Si Cantina).
 */
export function generateLabourInsight(params: {
  laborPct:       number;
  netSales?:      number | null;
  /** Simulated remaining revenue hours (rough: 0–1 scaling factor) */
  serviceFraction?: number;
}): LabourInsight {
  const { laborPct, netSales: _netSales, serviceFraction = 0.5 } = params;
  const TARGET_MIN = 18;
  const TARGET_MAX = 30;

  // Very rough projected-close: if we're at 40% now with 50% of day done, close ≈ 40%
  // If labour costs are somewhat fixed, the more revenue we do the lower pct gets.
  // Use a simple heuristic: projected = laborPct * (1 + (1-serviceFraction) * 0.15)
  const projectedClose = Math.round((laborPct * (1 + (1 - serviceFraction) * 0.15)) * 10) / 10;

  let status: LabourInsight["status"];
  let interpretation: string;
  let recommendation: string | undefined;

  if (laborPct <= TARGET_MIN) {
    status = "efficient";
    interpretation = `Well within target range (${TARGET_MIN}–${TARGET_MAX}%)`;
    recommendation = undefined;
  } else if (laborPct <= TARGET_MAX) {
    status = "healthy";
    interpretation = `Within target range (${TARGET_MIN}–${TARGET_MAX}%)`;
    recommendation = undefined;
  } else if (laborPct <= 40) {
    status = "elevated";
    interpretation = `Above target — ${(laborPct - TARGET_MAX).toFixed(1)}% over threshold`;
    recommendation = "Monitor through service. Avoid adding extra shifts.";
  } else if (laborPct <= 55) {
    status = "high";
    interpretation = `Labour high — margin pressure expected at close`;
    recommendation = "Reduce 1 FOH staff position this period to recover.";
  } else {
    status = "critical";
    interpretation = `Labour critical — significantly above sustainable range`;
    recommendation = "Immediate action required — reduce staffing now or close will be financially exposed.";
  }

  const labelMap: Record<LabourInsight["status"], string> = {
    efficient: "Efficient",
    healthy:   "Healthy",
    elevated:  "Elevated",
    high:      "High",
    critical:  "Critical",
  };

  return {
    pct:             laborPct,
    status,
    label:           labelMap[status],
    interpretation,
    projectedClose:  projectedClose > laborPct + 1 ? projectedClose : null,
    recommendation,
    targetMin:       TARGET_MIN,
    targetMax:       TARGET_MAX,
  };
}

// ── Service window countdown ──────────────────────────────────────────────────

export function minutesToServiceClose(): number {
  const s    = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  const date = new Date(s);
  const close = new Date(date);
  close.setHours(22, 0, 0, 0);
  if (date >= close) return 0;
  return Math.round((close.getTime() - date.getTime()) / 60_000);
}

// Severity ordering weight (lower = higher priority)
const SEVERITY_WEIGHT: Record<ActionSeverity, number> = {
  critical: 0,
  urgent:   1,
  action:   2,
  watch:    3,
};

// Category ordering weight (tie-break after severity)
const CATEGORY_WEIGHT: Record<ActionCategory, number> = {
  compliance:  0,
  maintenance: 1,
  revenue:     2,
  staffing:    3,
  events:      4,
  data:        5,
};

// ── Build priority actions ────────────────────────────────────────────────────

export function buildPriorityActions(params: {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  dailyOps:    DailyOperationsDashboardSummary;
  reviews:     SevenDayReviewSummary;
  events:      VenueEvent[];
  today:       string; // YYYY-MM-DD
}): DashboardAction[] {
  const { compliance, maintenance, forecast, dailyOps, reviews, events, today } = params;
  const actions: DashboardAction[] = [];

  // ── Compliance ────────────────────────────────────────────────────────────
  if (compliance.expired > 0) {
    const names = compliance.critical_items
      .slice(0, 2)
      .map((i) => i.display_name)
      .join(", ");
    const more = compliance.critical_items.length > 2
      ? ` +${compliance.critical_items.length - 2} more`
      : "";
    actions.push({
      severity:       "critical",
      category:       "compliance",
      title:          `${compliance.expired} compliance certificate${compliance.expired > 1 ? "s" : ""} expired`,
      message:        `${names}${more} — operating without valid certificates is a legal risk.`,
      recommendation: "Upload renewed certificates to the Compliance Hub immediately.",
      href:           "/dashboard/compliance",
      primaryAction:   { label: "Upload certificate", href: "/dashboard/compliance" },
      secondaryActions: [{ label: "View all", href: "/dashboard/compliance" }],
      impactWeight:   "required_today",
      impactLabel:    IMPACT_LABELS["required_today"],
      complianceItems: compliance.critical_items.map((i) => ({
        id: i.id, display_name: i.display_name, next_due_date: i.next_due_date,
        scheduled_service_date: i.scheduled_service_date, scheduled_with: i.scheduled_with,
      })),
    });
  }

  // Unscheduled due-soon items — genuine risk, no booking in place
  if (compliance.expired === 0 && compliance.due_soon > 0) {
    const nearest = compliance.due_soon_items[0];
    actions.push({
      severity:       "urgent",
      category:       "compliance",
      title:          `${compliance.due_soon} compliance item${compliance.due_soon > 1 ? "s" : ""} due soon — not yet booked`,
      message:        nearest
        ? `${nearest.display_name} expires${nearest.next_due_date ? ` on ${nearest.next_due_date}` : " shortly"} — no renewal scheduled.`
        : "Certificates are expiring within 30 days with no booking confirmed.",
      recommendation: "Book the renewal now — some authorities require 2–4 weeks of lead time.",
      href:           "/dashboard/compliance",
      primaryAction:   { label: "Schedule Renewal", href: "#schedule" },
      secondaryActions: [{ label: "View in Compliance Hub", href: "/dashboard/compliance" }],
      impactWeight:   "quick_win",
      impactLabel:    IMPACT_LABELS["quick_win"],
      complianceItems: compliance.due_soon_items.map((i) => ({
        id: i.id, display_name: i.display_name, next_due_date: i.next_due_date,
        scheduled_service_date: i.scheduled_service_date, scheduled_with: i.scheduled_with,
      })),
    });
  }

  // Proactively managed — service booked before expiry, no urgent action needed
  if (compliance.expired === 0 && compliance.due_soon === 0 && (compliance.scheduled ?? 0) > 0) {
    const nearest = compliance.scheduled_items?.[0];
    actions.push({
      severity:       "watch",
      category:       "compliance",
      title:          `${compliance.scheduled} compliance renewal${(compliance.scheduled ?? 0) > 1 ? "s" : ""} scheduled`,
      message:        nearest
        ? `${nearest.display_name} — service booked${nearest.scheduled_service_date ? ` for ${nearest.scheduled_service_date}` : ""}. Certificate remains valid.`
        : "Upcoming compliance renewals are booked before expiry. No action required.",
      recommendation: "No immediate action needed — confirm booked services are completed on schedule.",
      href:           "/dashboard/compliance",
      primaryAction:   { label: "View schedule", href: "/dashboard/compliance" },
      impactWeight:   "monitor",
      impactLabel:    IMPACT_LABELS["monitor"],
      complianceItems: (compliance.scheduled_items ?? []).map((i) => ({
        id: i.id, display_name: i.display_name, next_due_date: i.next_due_date,
        scheduled_service_date: i.scheduled_service_date, scheduled_with: i.scheduled_with,
      })),
    });
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  // 1. Food safety risks → always critical
  if (maintenance.foodSafetyRisks > 0) {
    const issue = maintenance.urgentIssues.find(
      (i) => i.impact_level === "food_safety_risk"
    ) ?? maintenance.urgentIssues[0];
    actions.push({
      severity:       "critical",
      category:       "maintenance",
      title:          `Food safety risk — ${maintenance.foodSafetyRisks} unresolved issue${maintenance.foodSafetyRisks > 1 ? "s" : ""}`,
      message:        issue
        ? `${issue.unit_name}: ${issue.issue_title} — reported ${Math.round((Date.now() - new Date(issue.date_reported + "T12:00:00Z").getTime()) / 86_400_000)} day(s) ago.`
        : "Active food safety maintenance issue requires immediate attention.",
      recommendation: "Resolve immediately — food safety issues risk service shutdown.",
      href:           "/dashboard/maintenance",
      primaryAction:   { label: "Resolve now", href: "/dashboard/maintenance" },
      secondaryActions: [{ label: "Call contractor", href: "/dashboard/maintenance" }],
      impactWeight:   "blocker",
      impactLabel:    IMPACT_LABELS["blocker"],
    });
  }

  // 2. Service disruption issues → urgent
  if (maintenance.serviceDisruptions > 0 && maintenance.foodSafetyRisks === 0) {
    const issue = maintenance.urgentIssues.find(
      (i) => i.impact_level === "service_disruption"
    );
    actions.push({
      severity:       "urgent",
      category:       "maintenance",
      title:          `Service disruption — ${maintenance.serviceDisruptions} active issue${maintenance.serviceDisruptions > 1 ? "s" : ""}`,
      message:        issue
        ? `${issue.unit_name}: ${issue.issue_title}`
        : "Open maintenance issue is disrupting service operations.",
      recommendation: "Prioritise fix before next service period.",
      href:           "/dashboard/maintenance",
      primaryAction:   { label: "Assign urgently", href: "/dashboard/maintenance" },
      secondaryActions: [{ label: "Call contractor", href: "/dashboard/maintenance" }],
      impactWeight:   "blocker",
      impactLabel:    IMPACT_LABELS["blocker"],
    });
  }

  // 3. Units out of service (not already covered by food safety / service disruption)
  if (maintenance.outOfService > 0) {
    const unitNames = maintenance.urgentIssues
      .filter((i) => i.repair_status === "open")
      .slice(0, 2)
      .map((i) => i.unit_name)
      .join(", ");
    actions.push({
      severity:       "urgent",
      category:       "maintenance",
      title:          `${maintenance.outOfService} unit${maintenance.outOfService > 1 ? "s" : ""} out of service`,
      message:        unitNames
        ? `${unitNames} ${maintenance.outOfService > 1 ? "are" : "is"} out of service.`
        : "Equipment units are currently out of service.",
      recommendation: "Schedule urgent repair or arrange replacement before service.",
      href:           "/dashboard/maintenance",
      primaryAction:   { label: "Assign repair", href: "/dashboard/maintenance" },
      secondaryActions: [{ label: "Call contractor", href: "/dashboard/maintenance" }],
      impactWeight:   "high_impact",
      impactLabel:    IMPACT_LABELS["high_impact"],
    });
  }

  // 4. Open repairs (catch-all when no higher-priority issue fired)
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;
  if (
    maintenance.openRepairs > 0 &&
    maintenance.foodSafetyRisks === 0 &&
    maintenance.serviceDisruptions === 0 &&
    maintenance.outOfService === 0
  ) {
    actions.push({
      severity:       "action",
      category:       "maintenance",
      title:          `${maintenance.openRepairs} open repair issue${maintenance.openRepairs > 1 ? "s" : ""}`,
      message:        `${totalOpen} total open/in-progress — review before service.`,
      recommendation: "Assign responsible staff and update repair status.",
      href:           "/dashboard/maintenance",
      primaryAction:   { label: "Assign", href: "/dashboard/maintenance" },
      secondaryActions: [{ label: "Mark fixed", href: "/dashboard/maintenance" }],
      impactWeight:   "quick_win",
      impactLabel:    IMPACT_LABELS["quick_win"],
    });
  }

  // 5. Compliance risk from maintenance (e.g. extraction system, fire suppression)
  if (maintenance.complianceRisks > 0) {
    actions.push({
      severity:       "urgent",
      category:       "maintenance",
      title:          `Compliance risk — ${maintenance.complianceRisks} maintenance issue${maintenance.complianceRisks > 1 ? "s" : ""}`,
      message:        "Open maintenance issue flagged as compliance risk.",
      recommendation: "Resolve or escalate before inspection deadlines.",
      href:           "/dashboard/maintenance",
      primaryAction:   { label: "Escalate", href: "/dashboard/maintenance" },
      impactWeight:   "required_today",
      impactLabel:    IMPACT_LABELS["required_today"],
    });
  }

  // ── Revenue ───────────────────────────────────────────────────────────────
  if (forecast && forecast.target_sales && forecast.sales_gap != null && forecast.sales_gap < 0) {
    const gapPctNum = Math.abs(forecast.sales_gap_pct ?? 0);
    const gapPct    = gapPctNum.toFixed(1);
    const gapAbs    = Math.abs(Math.round(forecast.sales_gap));
    const severity: ActionSeverity = gapPctNum >= 20 ? "urgent" : "action";
    const isHighRisk = gapPctNum >= 15;
    const extraCovers = forecast.required_extra_covers ?? 0;
    const avgSpend    = Math.round(forecast.forecast_avg_spend ?? 0);
    const recoveryMetric =
      extraCovers > 0 && avgSpend > 0
        ? `Need +${extraCovers} cover${extraCovers > 1 ? "s" : ""} at R${avgSpend} avg to recover`
        : `Requires R${gapAbs.toLocaleString("en-ZA")} additional revenue today`;
    actions.push({
      severity,
      category:          "revenue",
      title:             `Revenue at risk — ${gapPct}% below target`,
      message:           `Forecast R${gapAbs.toLocaleString("en-ZA")} short of today's target. ${forecast.risk_level === "high" ? "High-risk close." : "Recovery required."}`,
      recommendation:    forecast.recommendations?.[0]?.description ?? "Promote walk-ins and confirm open bookings.",
      href:              "/dashboard/settings/targets",
      primaryAction:     { label: "Add booking", href: "/dashboard/bookings" },
      secondaryActions:  [
        { label: "Trigger promotion", href: "/dashboard/settings/targets" },
        { label: "View revenue plan", href: "/dashboard/settings/targets" },
      ],
      impactWeight:      "high_impact",
      impactLabel:       IMPACT_LABELS["high_impact"],
      isHighRisk,
      recoveryMetric,
      serviceWindowMinutes: minutesToServiceClose(),
    });
  }

  // ── Staffing ──────────────────────────────────────────────────────────────
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;
  if (laborPct != null && laborPct > 35) {
    const severity: ActionSeverity = laborPct > 50 ? "urgent" : "action";
    actions.push({
      severity,
      category:       "staffing",
      title:          `Labour cost at ${laborPct.toFixed(1)}% — requires action`,
      message:        "Labour cost exceeds 35% threshold — margin pressure is high.",
      recommendation: "Review shift coverage and reduce overlap before next service.",
      href:           "/dashboard/operations",
      primaryAction:   { label: "Review staffing", href: "/dashboard/operations" },
      impactWeight:   laborPct > 50 ? "high_impact" : "quick_win",
      impactLabel:    IMPACT_LABELS[laborPct > 50 ? "high_impact" : "quick_win"],
      isHighRisk:     laborPct > 50,
      recoveryMetric: laborPct > 50
        ? `Cut 1 FOH position immediately to bring labour below 40%`
        : `Avoid adding shifts until labour drops below 35%`,
      serviceWindowMinutes: minutesToServiceClose(),
    });
  }

  // ── Data completeness ─────────────────────────────────────────────────────
  if (!dailyOps.latestReport) {
    actions.push({
      severity:       "action",
      category:       "data",
      title:          "Daily operations report missing",
      message:        "No daily ops report has been uploaded — labor and margin data unavailable.",
      recommendation: "Upload today's Toast Daily Operations report.",
      href:           "/dashboard/operations",
      primaryAction:   { label: "Upload report", href: "/dashboard/operations" },
      secondaryActions: [{ label: "Mark ignored", href: "/dashboard/operations" }],
      impactWeight:   "quick_win",
      impactLabel:    IMPACT_LABELS["quick_win"],
    });
  } else {
    // Check for stale report
    const ageDays = Math.round(
      (new Date(today + "T12:00:00Z").getTime() -
        new Date((dailyOps.latestReport.report_date ?? today) + "T12:00:00Z").getTime()) /
        86_400_000
    );
    if (ageDays > 2) {
      actions.push({
        severity:       "watch",
        category:       "data",
        title:          `Daily ops report ${ageDays} days old — requires update`,
        message:        `Last report was for ${dailyOps.latestReport.report_date}. Operational data may be stale.`,
        recommendation: "Upload the latest Daily Operations CSV from Toast.",
        href:           "/dashboard/operations",
        primaryAction:   { label: "Upload report", href: "/dashboard/operations" },
        impactWeight:   "quick_win",
        impactLabel:    IMPACT_LABELS["quick_win"],
      });
    }
  }

  if (reviews.totalReviews === 0) {
    actions.push({
      severity:       "watch",
      category:       "data",
      title:          "Reviews not synced — requires action",
      message:        "No reviews on record — reputation tracking is inactive.",
      recommendation: "Connect Google Reviews or log reviews manually.",
      href:           "/dashboard/reviews",
      primaryAction:   { label: "Connect source", href: "/dashboard/reviews" },
      secondaryActions: [{ label: "Log manually", href: "/dashboard/reviews" }],
      impactWeight:   "quick_win",
      impactLabel:    IMPACT_LABELS["quick_win"],
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  const todayEvent = events.find((e) => e.event_date === today && !e.cancelled);
  if (todayEvent) {
    actions.push({
      severity:       "watch",
      category:       "events",
      title:          `Event tonight: ${todayEvent.name}`,
      message:        `${todayEvent.start_time ? `Starts at ${todayEvent.start_time}. ` : ""}Expect higher traffic — confirm staffing now.`,
      recommendation: "Brief front-of-house and confirm staff levels for event service.",
      href:           "/dashboard/events",
      primaryAction:   { label: "View event", href: "/dashboard/events" },
      impactWeight:   "quick_win",
      impactLabel:    IMPACT_LABELS["quick_win"],
    });
  }

  // Sort by severity, then category priority
  return actions.sort((a, b) => {
    const sw = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (sw !== 0) return sw;
    return CATEGORY_WEIGHT[a.category] - CATEGORY_WEIGHT[b.category];
  });
}

// ── Restaurant Health Score ──────────────────────────────────────────────────

export interface HealthScoreBreakdown {
  compliance:  number; // 0–100
  maintenance: number;
  revenue:     number;
  staffing:    number;
  dataReady:   number;
}

export interface RestaurantHealthScore {
  total:     number; // 0–100
  status:    "Strong" | "Stable" | "Attention Needed" | "High Risk";
  breakdown: HealthScoreBreakdown;
}

export function computeHealthScore(params: {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  dailyOps:    DailyOperationsDashboardSummary;
  reviews:     SevenDayReviewSummary;
}): RestaurantHealthScore {
  const { compliance, maintenance, forecast, dailyOps, reviews } = params;

  // ── Compliance score (30%) ────────────────────────────────────────────────
  let complianceScore = 100;
  if (compliance.total > 0) {
    complianceScore = compliance.compliance_pct; // already 0–100
    if (compliance.expired > 0) complianceScore = Math.min(complianceScore, 40);
  }

  // ── Maintenance score (20%) ───────────────────────────────────────────────
  let maintenanceScore = 100;
  if (maintenance.totalEquipment > 0) {
    const atRiskRatio =
      (maintenance.outOfService * 2 + maintenance.openRepairs + maintenance.inProgress) /
      (maintenance.totalEquipment * 2);
    maintenanceScore = Math.max(0, Math.round((1 - atRiskRatio) * 100));
    if (maintenance.outOfService > 0) maintenanceScore = Math.min(maintenanceScore, 70);
  }

  // ── Revenue score (20%) ───────────────────────────────────────────────────
  let revenueScore = 70; // neutral baseline when no data
  if (forecast && forecast.target_sales && forecast.sales_gap != null) {
    const gapPct = forecast.sales_gap_pct ?? 0;
    if (gapPct >= 5)        revenueScore = 100;
    else if (gapPct >= 0)   revenueScore = 85;
    else if (gapPct >= -10) revenueScore = 70;
    else if (gapPct >= -20) revenueScore = 50;
    else                    revenueScore = 30;
  } else if (forecast && !forecast.target_sales) {
    revenueScore = 60; // has forecast but no target set
  }

  // ── Staffing score (15%) ──────────────────────────────────────────────────
  let staffingScore = 75; // neutral baseline
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;
  if (laborPct != null) {
    if (laborPct <= 30)      staffingScore = 100;
    else if (laborPct <= 35) staffingScore = 85;
    else if (laborPct <= 45) staffingScore = 65;
    else if (laborPct <= 55) staffingScore = 45;
    else                     staffingScore = 25;
  }

  // ── Data readiness score (15%) ────────────────────────────────────────────
  let dataReadyScore = 0;
  let dataItems = 0;
  if (dailyOps.latestReport) dataReadyScore += 35, dataItems++;
  if (reviews.totalReviews > 0) dataReadyScore += 30, dataItems++;
  if (forecast && forecast.factors.signal_count > 0) dataReadyScore += 35, dataItems++;
  if (dataItems === 0) dataReadyScore = 20;

  // ── Weighted total ────────────────────────────────────────────────────────
  const total = Math.round(
    complianceScore  * 0.30 +
    maintenanceScore * 0.20 +
    revenueScore     * 0.20 +
    staffingScore    * 0.15 +
    dataReadyScore   * 0.15
  );

  const status: RestaurantHealthScore["status"] =
    total >= 85 ? "Strong" :
    total >= 70 ? "Stable" :
    total >= 50 ? "Attention Needed" :
    "High Risk";

  return {
    total,
    status,
    breakdown: {
      compliance:  Math.round(complianceScore),
      maintenance: Math.round(maintenanceScore),
      revenue:     Math.round(revenueScore),
      staffing:    Math.round(staffingScore),
      dataReady:   Math.round(dataReadyScore),
    },
  };
}

// ── Service period ────────────────────────────────────────────────────────────

export function getServicePeriod(timeZone = "Africa/Johannesburg"): string {
  const hour = parseInt(
    new Date().toLocaleTimeString("en-ZA", { timeZone, hour: "2-digit", hour12: false }),
    10
  );
  if (hour >= 6  && hour < 11) return "Breakfast";
  if (hour >= 11 && hour < 15) return "Lunch";
  if (hour >= 15 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 23) return "Dinner";
  return "After Hours";
}
