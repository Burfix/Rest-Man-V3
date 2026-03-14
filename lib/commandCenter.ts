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

export type ActionSeverity = "critical" | "urgent" | "action" | "monitor";
export type ActionCategory =
  | "compliance"
  | "maintenance"
  | "revenue"
  | "staffing"
  | "events"
  | "data";

export interface DashboardAction {
  severity:       ActionSeverity;
  category:       ActionCategory;
  title:          string;
  message:        string;
  recommendation: string;
  href:           string;
}

// Severity ordering weight (lower = higher priority)
const SEVERITY_WEIGHT: Record<ActionSeverity, number> = {
  critical: 0,
  urgent:   1,
  action:   2,
  monitor:  3,
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
    });
  }

  if (compliance.expired === 0 && compliance.due_soon > 0) {
    const nearest = compliance.due_soon_items[0];
    actions.push({
      severity:       "urgent",
      category:       "compliance",
      title:          `${compliance.due_soon} compliance item${compliance.due_soon > 1 ? "s" : ""} due soon`,
      message:        nearest
        ? `${nearest.display_name} is due${nearest.next_due_date ? ` on ${nearest.next_due_date}` : " shortly"}.`
        : "Certificates are expiring within 30 days.",
      recommendation: "Begin renewal process — some authorities require 2–4 weeks of lead time.",
      href:           "/dashboard/compliance",
    });
  }

  // ── Maintenance ───────────────────────────────────────────────────────────
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
    });
  }

  if (maintenance.openRepairs > 0) {
    actions.push({
      severity:       "action",
      category:       "maintenance",
      title:          `${maintenance.openRepairs} open repair issue${maintenance.openRepairs > 1 ? "s" : ""}`,
      message:        `${maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts} total open/in-progress — review before service.`,
      recommendation: "Assign responsible staff and update repair status.",
      href:           "/dashboard/maintenance",
    });
  }

  // ── Revenue ───────────────────────────────────────────────────────────────
  if (forecast && forecast.target_sales && forecast.sales_gap != null && forecast.sales_gap < 0) {
    const gapPct = Math.abs(forecast.sales_gap_pct ?? 0).toFixed(1);
    const severity: ActionSeverity =
      Math.abs(forecast.sales_gap_pct ?? 0) >= 20 ? "urgent" : "action";
    actions.push({
      severity,
      category:       "revenue",
      title:          `Revenue forecast ${gapPct}% below target`,
      message:        `Forecast is R${Math.abs(forecast.sales_gap).toFixed(0)} below today's target — ${forecast.risk_level} risk.`,
      recommendation: forecast.recommendations?.[0]?.description ?? "Promote walk-ins and confirm open bookings.",
      href:           "/dashboard/settings/targets",
    });
  }

  // ── Staffing ──────────────────────────────────────────────────────────────
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;
  if (laborPct != null && laborPct > 35) {
    const severity: ActionSeverity = laborPct > 50 ? "urgent" : "action";
    actions.push({
      severity,
      category:       "staffing",
      title:          `Labor cost running at ${laborPct.toFixed(1)}%`,
      message:        "Labor cost exceeds 35% threshold — staffing pressure is high.",
      recommendation: "Review shift coverage and reduce overlap before next service.",
      href:           "/dashboard/operations",
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
        severity:       "monitor",
        category:       "data",
        title:          `Daily ops report ${ageDays} days old`,
        message:        `Last report was for ${dailyOps.latestReport.report_date}. Data may not reflect current operations.`,
        recommendation: "Upload the latest Daily Operations CSV from Toast.",
        href:           "/dashboard/operations",
      });
    }
  }

  if (reviews.totalReviews === 0) {
    actions.push({
      severity:       "monitor",
      category:       "data",
      title:          "Reviews not synced",
      message:        "No reviews on record — reputation monitoring is inactive.",
      recommendation: "Connect Google Reviews or log reviews manually.",
      href:           "/dashboard/reviews",
    });
  }

  // ── Events ────────────────────────────────────────────────────────────────
  const todayEvent = events.find((e) => e.event_date === today && !e.cancelled);
  if (todayEvent) {
    actions.push({
      severity:       "monitor",
      category:       "events",
      title:          `Event tonight: ${todayEvent.name}`,
      message:        `${todayEvent.start_time ? `Starts at ${todayEvent.start_time}. ` : ""}Expect higher traffic and booking enquiries.`,
      recommendation: "Brief front-of-house and confirm staff levels for event service.",
      href:           "/dashboard/events",
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
