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

export interface ActionButton {
  label: string;
  href:  string;
}

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
}

// ── Command Headline ──────────────────────────────────────────────────────────

export type HeadlineSeverity = "good" | "warning" | "urgent";

export interface CommandHeadline {
  severity:     HeadlineSeverity;
  text:         string;    // Short operator insight, e.g. "Behind target — push walk-ins before 18:00"
  subtext?:     string;    // Optional supporting detail
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
  const laborPct   = dailyOps.latestReport?.labor_cost_percent ?? null;
  const gapPct     = forecast?.sales_gap_pct ?? null;
  const gapAbs     = forecast?.sales_gap     ?? null;
  const isEvening  = servicePeriod === "Dinner" || servicePeriod === "After Hours";
  const isLunch    = servicePeriod === "Lunch" || servicePeriod === "Afternoon";

  // ── Critical safety / compliance blocks first ──────────────────────────
  if (maintenance.foodSafetyRisks > 0) {
    return {
      severity: "urgent",
      text:     `Food safety risk — immediate action required before service`,
      subtext:  `${maintenance.foodSafetyRisks} unresolved issue${maintenance.foodSafetyRisks > 1 ? "s" : ""} — resolve now to protect service continuity`,
    };
  }
  if (compliance.expired > 0) {
    return {
      severity: "urgent",
      text:     `${compliance.expired} compliance certificate${compliance.expired > 1 ? "s" : ""} expired — legal risk active`,
      subtext:  "Operating without valid certificates. Upload renewals immediately.",
    };
  }
  if (maintenance.serviceDisruptions > 0) {
    const issue = maintenance.urgentIssues.find((i) => i.impact_level === "service_disruption");
    return {
      severity: "urgent",
      text:     `Service disruption — ${issue ? issue.unit_name : "equipment"} issue requires immediate fix`,
      subtext:  "Resolve before next service period to protect guest experience.",
    };
  }

  // ── Revenue + labour headline ──────────────────────────────────────────
  const labourHigh  = laborPct != null && laborPct > 45;
  const labourRisk  = laborPct != null && laborPct > 35 && laborPct <= 45;
  const revBehind   = gapPct != null && gapPct < -10;
  const revWellBehind = gapPct != null && gapPct < -20;
  const revOnTrack  = gapPct != null && gapPct >= -5;
  const revAhead    = gapPct != null && gapPct >= 5;

  // Both bad
  if (revWellBehind && labourHigh) {
    const gap = gapAbs != null ? `R${Math.abs(gapAbs).toFixed(0)}` : "";
    return {
      severity: "urgent",
      text:     `Revenue weak and labour high — high-risk close`,
      subtext:  gap
        ? `Need ${gap} additional revenue. Reduce one FOH staff position and push walk-ins aggressively.`
        : "Reduce staffing and push walk-ins to improve margin close.",
    };
  }

  // Revenue well behind
  if (revWellBehind) {
    const gap = gapAbs != null ? `R${Math.abs(Math.round(gapAbs)).toLocaleString()}` : "";
    const timeHint = isEvening ? "before close" : isLunch ? "over lunch and dinner" : "before 18:00";
    return {
      severity: "urgent",
      text:     gap
        ? `Behind target — need ${gap} walk-in recovery ${timeHint}`
        : "Significantly behind revenue target — push walk-ins and confirm bookings",
      subtext: "Trigger a walk-in promotion and ensure floor staff are upselling.",
    };
  }

  if (revBehind) {
    const gap = gapAbs != null ? `R${Math.abs(Math.round(gapAbs)).toLocaleString()}` : "";
    return {
      severity: "warning",
      text:     gap
        ? `Behind target — ${gap} gap to close before end of service`
        : "Below revenue target — focus on dinner conversion",
      subtext: "Confirm all bookings, prioritise upsell on covers.",
    };
  }

  // Labour risk
  if (labourHigh) {
    return {
      severity: "warning",
      text:     `Labour running high at ${laborPct?.toFixed(1)}% — reduce staffing this period`,
      subtext:  "Current labour cost will pressure margin close. Review shift coverage now.",
    };
  }
  if (labourRisk) {
    return {
      severity: "warning",
      text:     `Labour elevated at ${laborPct?.toFixed(1)}% — monitor or reduce by end of service`,
      subtext:  "Within elevated range. Avoid adding extra shifts this period.",
    };
  }

  // On track + good bookings
  if (revAhead && today.total > 0) {
    return {
      severity: "good",
      text:     "Ahead of target — strong booking position",
      subtext:  `${today.totalCovers} covers confirmed. Focus on quality of service and upsell.`,
    };
  }
  if (revOnTrack && today.total > 0) {
    return {
      severity: "good",
      text:     "On track for revenue target — focus on dinner conversion",
      subtext:  `${today.totalCovers} covers confirmed. Confirm all pending bookings and maintain upsell.`,
    };
  }
  if (revOnTrack) {
    return {
      severity: "good",
      text:     "Revenue on track — walk-ins and upsell will secure the day",
      subtext:  "No major bookings confirmed yet. Ensure floor is ready for walk-in traffic.",
    };
  }

  // No forecast data
  if (!forecast) {
    if (maintenance.openRepairs > 0 || compliance.due_soon > 0) {
      return {
        severity: "warning",
        text:     "Operational items require attention before service",
        subtext:  "Review maintenance and compliance before the service period begins.",
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
    text:     "Operations stable — continue monitoring through service",
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
      primaryAction:   { label: "Upload certificate", href: "/dashboard/compliance" },
      secondaryActions: [{ label: "View all", href: "/dashboard/compliance" }],
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
      primaryAction:   { label: "Start renewal", href: "/dashboard/compliance" },
      secondaryActions: [{ label: "Assign owner", href: "/dashboard/compliance" }],
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
      primaryAction:   { label: "Add booking", href: "/dashboard/bookings" },
      secondaryActions: [
        { label: "Trigger promotion", href: "/dashboard/settings/targets" },
        { label: "View revenue plan", href: "/dashboard/settings/targets" },
      ],
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
      primaryAction:   { label: "Review staffing", href: "/dashboard/operations" },
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
        primaryAction:   { label: "Upload report", href: "/dashboard/operations" },
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
      primaryAction:   { label: "Connect source", href: "/dashboard/reviews" },
      secondaryActions: [{ label: "Log manually", href: "/dashboard/reviews" }],
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
      primaryAction:   { label: "View event", href: "/dashboard/events" },
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
