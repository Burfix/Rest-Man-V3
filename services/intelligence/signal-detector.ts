/**
 * Cross-Module Signal Detector
 *
 * Pure function — no async, no side effects.
 * Takes an OperationsContext (from context-builder.ts) and returns
 * all active compound signals sorted by severity.
 *
 * Each signal spans at least two modules, producing a recommendation
 * that no single module could generate alone.
 */

import type { OperationsContext } from "./context-builder";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignalSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "INFO";

export type SignalModule =
  | "REVENUE"
  | "LABOUR"
  | "OPS"
  | "MAINTENANCE"
  | "COMPLIANCE";

export type CrossModuleSignal = {
  id: string;
  modules: SignalModule[];
  severity: SignalSeverity;
  title: string;
  recommendation: string;
  moneyAtRisk?: number;    // calculated R amount
  timeWindow?: string;     // human-readable window
  confidence: number;      // 0–100 confidence score
  triggeredConditions: string[];  // which conditions fired — for debug/transparency
};

// ── Severity sort weight ──────────────────────────────────────────────────────

const SEV_WEIGHT: Record<SignalSeverity, number> = {
  CRITICAL: 4,
  HIGH:     3,
  MEDIUM:   2,
  INFO:     1,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

function pct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

// ── Signal definitions ────────────────────────────────────────────────────────

export function detectSignals(ctx: OperationsContext): CrossModuleSignal[] {
  const signals: CrossModuleSignal[] = [];

  const {
    revenue:     rev,
    labour:      lab,
    dailyOps:    ops,
    maintenance: maint,
    compliance:  comp,
    meta,
  } = ctx;

  const revGapAbs = rev.target > 0 ? Math.abs(rev.actual - rev.target) : 0;

  // ── SIGNAL 1 — Revenue Recovery Window ─────────────────────────────────────
  if (rev.variance < -20 && lab.variance > 5 && ops.completionRate < 60) {
    const conditions: string[] = [
      `Revenue ${pct(rev.variance)} vs target`,
      `Labour ${pct(lab.variance)} over`,
      `Ops ${ops.completionRate}% complete`,
    ];
    signals.push({
      id: "S1_REVENUE_RECOVERY_WINDOW",
      modules: ["REVENUE", "LABOUR", "OPS"],
      severity: "CRITICAL",
      title: "Revenue Recovery Window — Multi-System Drag",
      recommendation: `Revenue ${fmt(revGapAbs)} behind. Labour ${pct(lab.variance)} over. Ops ${ops.completionRate}% complete. Cut 1 FOH staff, push walk-in promo, escalate incomplete duties to GM.`,
      moneyAtRisk: revGapAbs,
      timeWindow: meta.timeOfDay === "service" ? "Until session end" : "Next service",
      confidence: 92,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 2 — Service Blocking Maintenance ────────────────────────────────
  // Fires whenever any open item has impact_level = service_disruption.
  // Does NOT require ops.blocked > 1 — the maintenance event alone is the trigger.
  if (maint.serviceBlocking) {
    const revenueCompound = rev.variance < -10;
    const conditions: string[] = [
      "Service-blocking maintenance active",
      ...(revenueCompound ? [`Revenue ${pct(rev.variance)} behind`] : []),
      ...(ops.blocked > 0 ? [`${ops.blocked} ops task${ops.blocked > 1 ? "s" : ""} blocked`] : []),
    ];
    signals.push({
      id: "S2_SERVICE_COLLAPSE_RISK",
      modules: revenueCompound
        ? ["MAINTENANCE", "OPS", "REVENUE"]
        : ["MAINTENANCE", "OPS"],
      severity: revenueCompound ? "CRITICAL" : "HIGH",
      title: revenueCompound
        ? "Service Collapse Risk — Maintenance + Revenue"
        : "Service-Blocking Maintenance Active",
      recommendation: revenueCompound
        ? `Service-blocking maintenance active. Revenue already ${pct(rev.variance)} behind. Resolve maintenance immediately — every service minute lost widens the gap.`
        : `Service-blocking maintenance active. Resolve immediately to prevent guest impact and revenue loss.`,
      moneyAtRisk: revenueCompound ? revGapAbs + revGapAbs * 0.15 : revGapAbs,
      timeWindow: "Immediate",
      confidence: 95,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 3 — Labour Efficiency Alert ─────────────────────────────────────
  if (lab.variance > 8 && rev.variance < 0 && ops.completionRate > 80) {
    const conditions: string[] = [
      `Labour ${pct(lab.variance)} over target`,
      `Revenue ${pct(rev.variance)} behind`,
      `Ops ${ops.completionRate}% complete`,
    ];
    signals.push({
      id: "S3_LABOUR_EFFICIENCY_ALERT",
      modules: ["LABOUR", "REVENUE"],
      severity: "HIGH",
      title: "Labour Efficiency Alert — Safe Reduction Window",
      recommendation: `Labour ${pct(lab.variance)} over target while revenue is behind. Ops covered at ${ops.completionRate}%. Safe to reduce floor staff by 1 — duties are covered.`,
      timeWindow: meta.timeOfDay === "service" ? "This session" : "Next shift",
      confidence: 85,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 4 — Compliance + Maintenance Compound Risk ──────────────────────
  if (comp.overdueCount > 0 && maint.urgentCount >= 2) {
    const conditions: string[] = [
      `${comp.overdueCount} compliance item${comp.overdueCount > 1 ? "s" : ""} overdue`,
      `${maint.urgentCount} urgent maintenance tickets`,
    ];
    signals.push({
      id: "S4_COMPLIANCE_MAINTENANCE_COMPOUND",
      modules: ["COMPLIANCE", "MAINTENANCE"],
      severity: "HIGH",
      title: "Compliance + Maintenance Compound Risk",
      recommendation: `${comp.overdueCount} compliance items overdue alongside ${maint.urgentCount} urgent maintenance. Combined risk for audit failure. Schedule resolution this week.`,
      timeWindow: "This week",
      confidence: 88,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 5 — Full System Green ───────────────────────────────────────────
  if (
    rev.variance > -5 &&
    lab.variance < 5 &&
    ops.completionRate > 85 &&
    !maint.serviceBlocking &&
    comp.overdueCount === 0
  ) {
    signals.push({
      id: "S5_FULL_SYSTEM_GREEN",
      modules: ["REVENUE", "LABOUR", "OPS"],
      severity: "INFO",
      title: "All Systems Nominal",
      recommendation: "All systems nominal. Monitor booking pace and floor energy.",
      confidence: 80,
      triggeredConditions: [
        `Revenue ${pct(rev.variance)} vs target`,
        `Labour ${pct(lab.variance)} vs target`,
        `Ops ${ops.completionRate}% complete`,
        "No service-blocking maintenance",
        "No overdue compliance",
      ],
    });
  }

  // ── SIGNAL 6 — Pre-Service Labour Surge ────────────────────────────────────
  if (meta.timeOfDay === "pre-service" && lab.variance > 10) {
    const conditions: string[] = [
      "Pre-service window active",
      `Labour already ${pct(lab.variance)} over target`,
    ];
    signals.push({
      id: "S6_PRE_SERVICE_LABOUR_SURGE",
      modules: ["LABOUR", "OPS"],
      severity: "MEDIUM",
      title: "Pre-Service Labour Surge",
      recommendation: `Labour already ${pct(lab.variance)} over target before service starts. Review clock-ons and stagger arrivals. Revenue hasn't arrived yet to justify current labour spend.`,
      timeWindow: "Before service",
      confidence: 80,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 7 — Ops + Maintenance Overload During Service ───────────────────
  if (meta.timeOfDay === "service" && ops.overdue > 2 && maint.urgentCount >= 1) {
    const conditions: string[] = [
      `${ops.overdue} ops tasks overdue`,
      `${maint.urgentCount} urgent maintenance during service`,
    ];
    signals.push({
      id: "S7_OPS_MAINTENANCE_OVERLOAD",
      modules: ["OPS", "MAINTENANCE"],
      severity: "HIGH",
      title: "Ops + Maintenance Overload During Service",
      recommendation: `${ops.overdue} ops tasks overdue and ${maint.urgentCount} urgent maintenance active during service. Team is stretched. Escalate maintenance to contractor, triage ops by GM priority.`,
      timeWindow: "This service",
      confidence: 87,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 8 — Unexplained Revenue Gap ─────────────────────────────────────
  if (
    rev.variance < -15 &&
    !maint.serviceBlocking &&
    ops.completionRate > 80 &&
    comp.overdueCount === 0
  ) {
    const conditions: string[] = [
      `Revenue ${pct(rev.variance)} behind`,
      "No service-blocking maintenance",
      `Ops ${ops.completionRate}% complete`,
      "Compliance clean",
    ];
    signals.push({
      id: "S8_UNEXPLAINED_REVENUE_GAP",
      modules: ["REVENUE", "LABOUR", "OPS"],
      severity: "HIGH",
      title: "Unexplained Revenue Gap",
      recommendation: `Revenue ${pct(rev.variance)} behind but ops, maintenance, and compliance are clean. Review floor conversion, upsell performance, and walk-in capture.`,
      moneyAtRisk: revGapAbs,
      timeWindow: meta.timeOfDay === "service" ? "This session" : "Today",
      confidence: 78,
      triggeredConditions: conditions,
    });
  }

  // ── SIGNAL 9 — Revenue Behind Pace (Service, standalone) ───────────────────
  // Fires when revenue is meaningfully behind during service without requiring
  // compound conditions (unlike S1 which also needs labour + ops triggers).
  // Guards against duplicate: suppressed when S1 is already active.
  // Threshold lowered to -15 to catch moderate gaps that voice generator flags.
  if (
    meta.timeOfDay === "service" &&
    rev.variance < -15 &&
    rev.target > 0 &&
    !signals.some((s) => s.id === "S1_REVENUE_RECOVERY_WINDOW")
  ) {
    signals.push({
      id: "S9_REVENUE_BEHIND_PACE",
      modules: ["REVENUE"],
      severity: rev.variance < -25 ? "CRITICAL" : "HIGH",
      title: rev.variance < -25 ? "Revenue Critically Behind Pace" : "Revenue Behind Pace",
      recommendation: `Revenue ${pct(rev.variance)} behind target during service. Push floor conversion, walk-in capture, and table turn rate.`,
      moneyAtRisk: revGapAbs,
      timeWindow: "This session",
      confidence: 88,
      triggeredConditions: [`Revenue ${pct(rev.variance)} during service`],
    });
  }

  // ── SIGNAL 10 — Revenue Behind + Operational Lag ────────────────────────────
  // Mirrors voice-generator state 11: revenue behind AND ops below 70%.
  // Catches the scenario where S8 can't fire (ops too low) but there is a
  // genuine compound risk between revenue and duty completion.
  // Suppressed when S1 or S9 is already active (they cover revenue signals).
  if (
    meta.timeOfDay === "service" &&
    rev.variance < -10 &&
    ops.completionRate < 70 &&
    !signals.some((s) =>
      s.id === "S1_REVENUE_RECOVERY_WINDOW" || s.id === "S9_REVENUE_BEHIND_PACE"
    )
  ) {
    signals.push({
      id: "S10_REVENUE_OPS_LAG",
      modules: ["REVENUE", "OPS"],
      severity: rev.variance < -20 || ops.completionRate < 40 ? "HIGH" : "MEDIUM",
      title: "Revenue Behind + Operational Lag",
      recommendation: `Address ops backlog immediately — ${ops.completionRate}% duties complete while revenue is ${pct(rev.variance)} behind. Compound risk if both persist.`,
      moneyAtRisk: revGapAbs,
      timeWindow: "This session",
      confidence: 82,
      triggeredConditions: [
        `Revenue ${pct(rev.variance)} behind target`,
        `Only ${ops.completionRate}% of duties complete`,
      ],
    });
  }

  // ── SIGNAL 11 — Compliance Overdue / At Risk (standalone) ─────────────────
  // Fires on ANY overdue item (CRITICAL) or any at-risk item (HIGH).
  // Even a single expired certificate is a legal/audit risk — threshold is 1.
  // S4 handles the compound compliance + maintenance case; suppressed here.
  if (
    (comp.overdueCount >= 1 || comp.atRiskCount > 0) &&
    !signals.some((s) => s.id === "S4_COMPLIANCE_MAINTENANCE_COMPOUND")
  ) {
    const isExpired = comp.overdueCount >= 1;
    const itemCount = isExpired ? comp.overdueCount : comp.atRiskCount;
    const itemWord  = itemCount === 1 ? "item" : "items";
    signals.push({
      id: "S11_COMPLIANCE_OVERDUE",
      modules: ["COMPLIANCE"],
      severity: isExpired ? "CRITICAL" : "HIGH",
      title: isExpired
        ? `${itemCount} Expired Compliance ${itemWord === "item" ? "Item" : "Items"}`
        : `${itemCount} Compliance ${itemCount === 1 ? "Item" : "Items"} At Risk`,
      recommendation: isExpired
        ? `${itemCount} compliance ${itemWord} expired. Operating with expired certificates creates legal, audit, and insurance exposure. Escalate to head office and schedule renewal immediately.`
        : `${itemCount} compliance ${itemWord} due soon. Action before expiry to avoid operational risk.`,
      moneyAtRisk: isExpired ? 50_000 : 0,
      timeWindow: "Today",
      confidence: 95,
      triggeredConditions: isExpired
        ? [`${itemCount} compliance ${itemWord} overdue — legal and audit exposure`]
        : [`${itemCount} compliance ${itemWord} at risk of expiry`],
    });
  }

  // ── Sort by severity ────────────────────────────────────────────────────────
  return signals.sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity]);
}
