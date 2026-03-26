/**
 * ForgeStack Decision Engine v1
 *
 * Central intelligence layer that evaluates all operational signals and
 * produces structured output for every section of the Operating Brain.
 *
 * Rules are deterministic — no AI calls. Pure business logic.
 */

// ─── Input / Output Types ────────────────────────────────────────────────────

export type EvaluateOperationsInput = {
  revenue: {
    actual: number;
    target: number;
    variancePercent: number;
    covers: number;
    avgSpend: number;
    sameDayLastYear?: number;
  };
  labour: {
    labourPercent: number;
    targetPercent: number;
    activeStaff?: number;
    overtimeCost?: number;
    syncAgeMinutes?: number;
  };
  inventory: {
    criticalCount: number;
    lowCount: number;
    noOpenPOCount: number;
    atRiskItems?: Array<{
      name: string;
      affectedMenuItems?: string[];
      severity: "critical" | "warning";
    }>;
    syncAgeMinutes?: number;
  };
  maintenance: {
    openIssues: number;
    urgentIssues: number;
    topIssue?: string;
    serviceBlocking?: boolean;
  };
  compliance: {
    score: number;
    currentPercent: number;
    renewalsScheduled?: number;
    criticalMissing?: number;
  };
  forecast: {
    peakWindow?: string;
    peakTime?: string;
    forecastSales?: number;
    forecastCovers?: number;
    actualVsForecastPercent?: number;
    confidence?: "low" | "medium" | "high";
    timeToPeakMinutes?: number;
  };
  bookings: {
    lunchBookings?: number;
    dinnerBookings?: number;
    walkInReliance?: "low" | "medium" | "high";
  };
  freshness: {
    salesAgeMinutes?: number;
    labourAgeMinutes?: number;
    inventoryAgeMinutes?: number;
    reviewsAgeDays?: number;
  };
};

export type OperatingDecision = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  category:
    | "revenue"
    | "labour"
    | "inventory"
    | "maintenance"
    | "compliance"
    | "service"
    | "forecast";
  title: string;
  explanation: string;
  action: string;
  impact?: {
    type:
      | "revenue_protected"
      | "cost_saved"
      | "service_risk"
      | "compliance_risk";
    value?: number;
    label: string;
  };
  due?: string;
  confidence?: "low" | "medium" | "high";
};

export type BusinessStatusTone = "positive" | "warning" | "critical" | "neutral";

export type EvaluateOperationsOutput = {
  operatingCommandBar: {
    status: "healthy" | "needs_attention" | "critical";
    label: string;
    issueCount: number;
    revenueAtRisk?: number;
    timeToPeakLabel?: string;
    topActions: string[];
  };
  sinceLastCheck: Array<{
    label: string;
    direction?: "up" | "down" | "new";
    tone?: "positive" | "warning" | "critical" | "neutral";
  }>;
  commandFeed: OperatingDecision[];
  whatToDoNow: OperatingDecision[];
  businessStatus: {
    revenue: {
      label: string;
      tone: BusinessStatusTone;
      supportingText: string;
    };
    labour: {
      label: string;
      tone: BusinessStatusTone;
      supportingText: string;
    };
    inventory: {
      label: string;
      tone: BusinessStatusTone;
      supportingText: string;
    };
    maintenance: {
      label: string;
      tone: BusinessStatusTone;
      supportingText: string;
    };
    compliance: {
      label: string;
      tone: BusinessStatusTone;
      supportingText: string;
    };
  };
  dataHealth: {
    status: "good" | "warning" | "stale";
    summary: string;
    details: Array<{ source: string; label: string; tone: string }>;
  };
  servicePulseInsights: string[];
  suggestedPlaybook: string[];
  operatingScoreBreakdown: Array<{
    label: string;
    score: number;
    maxScore: number;
    reason: string;
  }>;
};

// ─── Severity weights for sorting ────────────────────────────────────────────

const SEV_WEIGHT: Record<OperatingDecision["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `d-${_idCounter}`;
}

function pct(v: number): string {
  return `${Math.abs(v).toFixed(1)}%`;
}

function rands(v: number): string {
  return `R${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function freshnessLabel(minutes?: number): string {
  if (minutes == null) return "unknown";
  if (minutes < 15) return "live";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

// ─── Confidence downgrade based on data freshness ────────────────────────────

function effectiveConfidence(
  base: "low" | "medium" | "high" | undefined,
  freshness: EvaluateOperationsInput["freshness"],
): "low" | "medium" | "high" {
  const staleThresholds = [
    freshness.salesAgeMinutes != null && freshness.salesAgeMinutes > 120,
    freshness.labourAgeMinutes != null && freshness.labourAgeMinutes > 120,
  ];
  const staleCount = staleThresholds.filter(Boolean).length;
  if (staleCount >= 2) return "low";
  if (staleCount === 1 && (base === "high" || base === "medium")) return "medium";
  return base ?? "medium";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EVALUATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

export function evaluateOperations(
  input: EvaluateOperationsInput,
): EvaluateOperationsOutput {
  _idCounter = 0;
  const decisions: OperatingDecision[] = [];
  const confidence = effectiveConfidence(input.forecast.confidence, input.freshness);

  // ── Rule 1: Labour cost vs revenue gap ─────────────────────────────────
  if (
    input.labour.labourPercent > input.labour.targetPercent &&
    input.revenue.variancePercent < 0
  ) {
    const excess = input.labour.labourPercent - input.labour.targetPercent;
    decisions.push({
      id: nextId(),
      severity: excess > 10 ? "critical" : "high",
      category: "labour",
      title: `Labour running ${pct(excess)} over target`,
      explanation: `Labour at ${input.labour.labourPercent.toFixed(1)}% against ${input.labour.targetPercent}% target while revenue is ${pct(input.revenue.variancePercent)} behind.`,
      action:
        excess > 10
          ? "Cut 1 FOH position immediately and push upsell strategy"
          : "Review tonight's roster — consider sending 1 staff home early",
      impact: {
        type: "cost_saved",
        value: Math.round(
          (excess / 100) * input.revenue.actual * 0.3,
        ),
        label: `Save ~${rands((excess / 100) * input.revenue.actual * 0.3)} in labour costs`,
      },
      confidence,
    });
  } else if (input.labour.labourPercent > input.labour.targetPercent) {
    decisions.push({
      id: nextId(),
      severity: "medium",
      category: "labour",
      title: `Labour at ${input.labour.labourPercent.toFixed(1)}% — above ${input.labour.targetPercent}% target`,
      explanation: "Revenue is tracking but labour cost is elevated. Monitor before cutting.",
      action: "Watch labour through dinner — review at close",
      confidence,
    });
  }

  // ── Rule 2: Service-blocking maintenance ───────────────────────────────
  if (input.maintenance.serviceBlocking) {
    decisions.push({
      id: nextId(),
      severity: "critical",
      category: "service",
      title: input.maintenance.topIssue
        ? `${input.maintenance.topIssue} — blocking service`
        : "Equipment blocking service",
      explanation:
        "A maintenance issue is directly impacting guest service. Fix before next service period or risk revenue loss.",
      action: "Fix or arrange workaround before next peak",
      impact: {
        type: "service_risk",
        label: "Service disruption — guest experience at risk",
      },
      due: "Before next service",
      confidence: "high",
    });
  }

  // ── Rule 3: Critical inventory stockouts ───────────────────────────────
  if (input.inventory.criticalCount > 0) {
    const items = input.inventory.atRiskItems?.filter(
      (i) => i.severity === "critical",
    );
    const names = items?.map((i) => i.name).join(", ") ?? "items";
    const menuHits = items
      ?.flatMap((i) => i.affectedMenuItems ?? [])
      .slice(0, 3);
    decisions.push({
      id: nextId(),
      severity: "critical",
      category: "inventory",
      title: `${input.inventory.criticalCount} critical stockout${input.inventory.criticalCount > 1 ? "s" : ""} — ${names}`,
      explanation: menuHits?.length
        ? `Menu items impacted: ${menuHits.join(", ")}. Stock depleted.`
        : "Critical stock depleted. Menu items may be unavailable.",
      action: "Emergency order or 86 affected dishes now",
      impact: {
        type: "revenue_protected",
        label: "Prevent menu gaps and lost sales",
      },
      due: "Immediate",
      confidence: "high",
    });
  }

  // ── Rule 4: Low stock + no open PO ────────────────────────────────────
  if (input.inventory.lowCount > 0 && input.inventory.noOpenPOCount > 0) {
    decisions.push({
      id: nextId(),
      severity: "high",
      category: "inventory",
      title: `${input.inventory.noOpenPOCount} low-stock item${input.inventory.noOpenPOCount > 1 ? "s" : ""} without purchase orders`,
      explanation: `${input.inventory.lowCount} items running low and ${input.inventory.noOpenPOCount} have no open PO. Risk of stockout within 24–48h.`,
      action: "Place orders for unprotected items today",
      impact: {
        type: "revenue_protected",
        label: "Prevent tomorrow's stockout",
      },
      due: "Today",
      confidence,
    });
  }

  // ── Rule 5: Peak approaching ──────────────────────────────────────────
  if (
    input.forecast.timeToPeakMinutes != null &&
    input.forecast.timeToPeakMinutes <= 60
  ) {
    decisions.push({
      id: nextId(),
      severity: input.forecast.timeToPeakMinutes <= 30 ? "high" : "medium",
      category: "forecast",
      title:
        input.forecast.timeToPeakMinutes <= 15
          ? "Peak starting now — all stations ready?"
          : `Peak in ${input.forecast.timeToPeakMinutes} mins — prep now`,
      explanation: input.forecast.peakWindow
        ? `Peak window: ${input.forecast.peakWindow}. Forecast: ${input.forecast.forecastCovers ?? "—"} covers.`
        : "Service peak is imminent.",
      action: "Confirm FOH coverage, check prep completion, brief kitchen",
      impact: {
        type: "revenue_protected",
        label: "Smooth peak service = max covers captured",
      },
      due: `${input.forecast.timeToPeakMinutes}m`,
      confidence,
    });
  }

  // ── Rule 6: Low bookings + high walk-in reliance ───────────────────────
  const totalBookings =
    (input.bookings.lunchBookings ?? 0) + (input.bookings.dinnerBookings ?? 0);
  if (totalBookings < 10 && input.bookings.walkInReliance === "high") {
    decisions.push({
      id: nextId(),
      severity: "medium",
      category: "revenue",
      title: "Low bookings — relying on walk-ins",
      explanation: `Only ${totalBookings} bookings today. Walk-in reliance is high. Revenue at risk if foot traffic is slow.`,
      action:
        "Push walk-in specials, social media post, and upsell strategy with FOH team",
      impact: {
        type: "revenue_protected",
        label: "Drive walk-in conversion",
      },
      confidence,
    });
  }

  // ── Rule 7: Stale data warnings ───────────────────────────────────────
  const staleWarnings: string[] = [];
  if (
    input.freshness.salesAgeMinutes != null &&
    input.freshness.salesAgeMinutes > 120
  )
    staleWarnings.push(
      `Sales data is ${freshnessLabel(input.freshness.salesAgeMinutes)}`,
    );
  if (
    input.freshness.labourAgeMinutes != null &&
    input.freshness.labourAgeMinutes > 120
  )
    staleWarnings.push(
      `Labour data is ${freshnessLabel(input.freshness.labourAgeMinutes)}`,
    );

  if (staleWarnings.length > 0) {
    decisions.push({
      id: nextId(),
      severity: staleWarnings.length >= 2 ? "high" : "medium",
      category: "service",
      title: "Decisions using stale data",
      explanation: staleWarnings.join(". ") + ".",
      action: "Sync latest data from MICROS",
      impact: {
        type: "service_risk",
        label: "Low confidence in current recommendations",
      },
      confidence: "low",
    });
  }

  // ── Rule 8: Compliance is high, but maintenance is top issue ──────────
  if (
    input.compliance.currentPercent >= 85 &&
    input.maintenance.urgentIssues > 0 &&
    input.maintenance.openIssues > input.compliance.criticalMissing!
  ) {
    decisions.push({
      id: nextId(),
      severity: "high",
      category: "maintenance",
      title: `${input.maintenance.urgentIssues} urgent maintenance issue${input.maintenance.urgentIssues > 1 ? "s" : ""} — primary risk driver`,
      explanation: `Compliance is strong at ${input.compliance.currentPercent.toFixed(0)}%. Maintenance is the bigger operational risk right now.`,
      action: input.maintenance.topIssue
        ? `Fix ${input.maintenance.topIssue} first`
        : "Address top maintenance item now",
      impact: {
        type: "service_risk",
        label: "Equipment failure threatens service quality",
      },
      confidence,
    });
  }

  // ── Additional: Revenue gap ───────────────────────────────────────────
  if (input.revenue.variancePercent < -10) {
    const gap = input.revenue.target - input.revenue.actual;
    const coversNeeded =
      input.revenue.avgSpend > 0
        ? Math.ceil(gap / input.revenue.avgSpend)
        : null;
    decisions.push({
      id: nextId(),
      severity: input.revenue.variancePercent < -20 ? "critical" : "high",
      category: "revenue",
      title: `Revenue ${pct(input.revenue.variancePercent)} behind target`,
      explanation: `Gap of ${rands(gap)} to target.${coversNeeded ? ` Need +${coversNeeded} covers at ${rands(input.revenue.avgSpend)} avg spend.` : ""}`,
      action: "Push upsell, activate walk-in promos, extend peak staffing",
      impact: {
        type: "revenue_protected",
        value: gap,
        label: `Close ${rands(gap)} gap`,
      },
      confidence,
    });
  }

  // ── Additional: Compliance critical missing ───────────────────────────
  if (
    input.compliance.criticalMissing != null &&
    input.compliance.criticalMissing > 0
  ) {
    decisions.push({
      id: nextId(),
      severity: "critical",
      category: "compliance",
      title: `${input.compliance.criticalMissing} expired compliance item${input.compliance.criticalMissing > 1 ? "s" : ""}`,
      explanation: "Operating with expired certificates or permits. Legal and operational risk.",
      action: "Schedule renewal immediately — escalate to head office if blocked",
      impact: {
        type: "compliance_risk",
        label: "Regulatory exposure",
      },
      due: "Today",
      confidence: "high",
    });
  }

  // ── Additional: Maintenance open issues (non-blocking) ────────────────
  if (
    !input.maintenance.serviceBlocking &&
    input.maintenance.openIssues > 0
  ) {
    decisions.push({
      id: nextId(),
      severity:
        input.maintenance.urgentIssues > 0 ? "medium" : "low",
      category: "maintenance",
      title: `${input.maintenance.openIssues} open maintenance issue${input.maintenance.openIssues > 1 ? "s" : ""}`,
      explanation: input.maintenance.topIssue
        ? `Top: ${input.maintenance.topIssue}. ${input.maintenance.urgentIssues} marked urgent.`
        : `${input.maintenance.urgentIssues} urgent, ${input.maintenance.openIssues - input.maintenance.urgentIssues} standard.`,
      action: "Review and assign before end of shift",
      confidence,
    });
  }

  // ── Sort all decisions (Rule 11) ──────────────────────────────────────
  decisions.sort((a, b) => SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity]);

  // ── Build output sections ─────────────────────────────────────────────

  const critCount = decisions.filter(
    (d) => d.severity === "critical" || d.severity === "high",
  ).length;
  const revenueAtRisk =
    input.revenue.variancePercent < 0
      ? Math.round(input.revenue.target - input.revenue.actual)
      : undefined;

  // ── Operating Command Bar (Rule 9: max 3 top actions) ─────────────────
  const barStatus: EvaluateOperationsOutput["operatingCommandBar"]["status"] =
    decisions.some((d) => d.severity === "critical")
      ? "critical"
      : critCount > 0
        ? "needs_attention"
        : "healthy";

  const barLabel =
    barStatus === "critical"
      ? "Critical issues need your attention"
      : barStatus === "needs_attention"
        ? `${critCount} issue${critCount > 1 ? "s" : ""} need${critCount === 1 ? "s" : ""} attention`
        : "Operations running smoothly";

  const timeToPeakLabel =
    input.forecast.timeToPeakMinutes != null
      ? input.forecast.timeToPeakMinutes <= 0
        ? "Peak now"
        : `Peak in ${input.forecast.timeToPeakMinutes}m`
      : input.forecast.peakWindow
        ? `Peak: ${input.forecast.peakWindow}`
        : undefined;

  const operatingCommandBar: EvaluateOperationsOutput["operatingCommandBar"] = {
    status: barStatus,
    label: barLabel,
    issueCount: critCount,
    revenueAtRisk,
    timeToPeakLabel,
    topActions: decisions.slice(0, 3).map((d) => d.title),
  };

  // ── Since Last Check ──────────────────────────────────────────────────
  const sinceLastCheck: EvaluateOperationsOutput["sinceLastCheck"] = [];
  if (input.revenue.variancePercent < -5) {
    sinceLastCheck.push({
      label: `Revenue ${pct(input.revenue.variancePercent)} behind`,
      direction: "down",
      tone: "warning",
    });
  } else if (input.revenue.variancePercent > 5) {
    sinceLastCheck.push({
      label: `Revenue ${pct(input.revenue.variancePercent)} ahead`,
      direction: "up",
      tone: "positive",
    });
  }
  if (input.inventory.criticalCount > 0) {
    sinceLastCheck.push({
      label: `${input.inventory.criticalCount} critical stockout${input.inventory.criticalCount > 1 ? "s" : ""}`,
      direction: "new",
      tone: "critical",
    });
  }
  if (input.labour.labourPercent > input.labour.targetPercent + 5) {
    sinceLastCheck.push({
      label: `Labour at ${input.labour.labourPercent.toFixed(1)}%`,
      direction: "up",
      tone: "warning",
    });
  }
  if (input.maintenance.serviceBlocking) {
    sinceLastCheck.push({
      label: "Equipment blocking service",
      direction: "new",
      tone: "critical",
    });
  }

  // ── Command Feed (Rule 10: max 5) ─────────────────────────────────────
  const commandFeed = decisions.slice(0, 5);

  // ── What To Do Now (top 3 actionable) ─────────────────────────────────
  const whatToDoNow = decisions
    .filter(
      (d) => d.severity === "critical" || d.severity === "high",
    )
    .slice(0, 3);
  // If no critical/high, take top medium
  if (whatToDoNow.length === 0 && decisions.length > 0) {
    whatToDoNow.push(decisions[0]);
  }

  // ── Business Status ───────────────────────────────────────────────────
  const businessStatus: EvaluateOperationsOutput["businessStatus"] = {
    revenue: {
      label:
        input.revenue.variancePercent >= 0
          ? `${pct(input.revenue.variancePercent)} ahead`
          : `${pct(input.revenue.variancePercent)} behind`,
      tone:
        input.revenue.variancePercent >= 0
          ? "positive"
          : input.revenue.variancePercent > -10
            ? "warning"
            : "critical",
      supportingText: `${rands(input.revenue.actual)} of ${rands(input.revenue.target)} target • ${input.revenue.covers} covers`,
    },
    labour: {
      label:
        input.labour.labourPercent <= input.labour.targetPercent
          ? "On target"
          : `${pct(input.labour.labourPercent - input.labour.targetPercent)} over`,
      tone:
        input.labour.labourPercent <= input.labour.targetPercent
          ? "positive"
          : input.labour.labourPercent > input.labour.targetPercent + 10
            ? "critical"
            : "warning",
      supportingText: `${input.labour.labourPercent.toFixed(1)}% of sales${input.labour.activeStaff ? ` • ${input.labour.activeStaff} active staff` : ""}`,
    },
    inventory: {
      label:
        input.inventory.criticalCount > 0
          ? `${input.inventory.criticalCount} critical`
          : input.inventory.lowCount > 0
            ? `${input.inventory.lowCount} low`
            : "Healthy",
      tone:
        input.inventory.criticalCount > 0
          ? "critical"
          : input.inventory.lowCount > 0
            ? "warning"
            : "positive",
      supportingText:
        input.inventory.criticalCount > 0
          ? `${input.inventory.noOpenPOCount} without purchase orders`
          : input.inventory.lowCount > 0
            ? `${input.inventory.noOpenPOCount} need orders`
            : "All stock levels healthy",
    },
    maintenance: {
      label:
        input.maintenance.serviceBlocking
          ? "Service blocked"
          : input.maintenance.urgentIssues > 0
            ? `${input.maintenance.urgentIssues} urgent`
            : input.maintenance.openIssues > 0
              ? `${input.maintenance.openIssues} open`
              : "All clear",
      tone: input.maintenance.serviceBlocking
        ? "critical"
        : input.maintenance.urgentIssues > 0
          ? "warning"
          : "positive",
      supportingText: input.maintenance.topIssue ?? "No issues",
    },
    compliance: {
      label:
        (input.compliance.criticalMissing ?? 0) > 0
          ? `${input.compliance.criticalMissing} expired`
          : `${input.compliance.currentPercent.toFixed(0)}% compliant`,
      tone:
        (input.compliance.criticalMissing ?? 0) > 0
          ? "critical"
          : input.compliance.currentPercent >= 90
            ? "positive"
            : "warning",
      supportingText:
        input.compliance.renewalsScheduled != null &&
        input.compliance.renewalsScheduled > 0
          ? `${input.compliance.renewalsScheduled} renewal${input.compliance.renewalsScheduled > 1 ? "s" : ""} scheduled`
          : "No upcoming renewals",
    },
  };

  // ── Data Health ───────────────────────────────────────────────────────
  const details: EvaluateOperationsOutput["dataHealth"]["details"] = [];
  const addFreshness = (
    source: string,
    ageMin?: number,
    ageDays?: number,
  ) => {
    if (ageDays != null) {
      details.push({
        source,
        label: ageDays === 0 ? "Today" : `${ageDays}d ago`,
        tone: ageDays <= 1 ? "positive" : ageDays <= 3 ? "warning" : "critical",
      });
    } else if (ageMin != null) {
      details.push({
        source,
        label: freshnessLabel(ageMin),
        tone: ageMin <= 30 ? "positive" : ageMin <= 120 ? "warning" : "critical",
      });
    } else {
      details.push({ source, label: "No data", tone: "critical" });
    }
  };
  addFreshness("Sales", input.freshness.salesAgeMinutes);
  addFreshness("Labour", input.freshness.labourAgeMinutes);
  addFreshness("Inventory", input.freshness.inventoryAgeMinutes);
  addFreshness("Reviews", undefined, input.freshness.reviewsAgeDays);

  const staleCount = details.filter((d) => d.tone === "critical").length;
  const warnCount = details.filter((d) => d.tone === "warning").length;
  const dataHealth: EvaluateOperationsOutput["dataHealth"] = {
    status: staleCount >= 2 ? "stale" : staleCount > 0 || warnCount >= 2 ? "warning" : "good",
    summary:
      staleCount >= 2
        ? `${staleCount} data sources are stale — decisions may not reflect reality`
        : staleCount > 0
          ? "Some data is delayed — monitor freshness"
          : "All data sources are current",
    details,
  };

  // ── Service Pulse Insights ────────────────────────────────────────────
  const servicePulseInsights: string[] = [];
  if (
    input.forecast.timeToPeakMinutes != null &&
    input.forecast.timeToPeakMinutes <= 60
  ) {
    servicePulseInsights.push(
      `Peak in ${input.forecast.timeToPeakMinutes} mins — prep now`,
    );
  }
  if (input.revenue.variancePercent < -10) {
    const coversNeeded =
      input.revenue.avgSpend > 0
        ? Math.ceil(
            (input.revenue.target - input.revenue.actual) /
              input.revenue.avgSpend,
          )
        : null;
    servicePulseInsights.push(
      coversNeeded
        ? `Behind forecast — need +${coversNeeded} covers`
        : `Behind forecast by ${pct(input.revenue.variancePercent)}`,
    );
  }
  if (input.revenue.variancePercent > 5) {
    servicePulseInsights.push(
      `${pct(input.revenue.variancePercent)} ahead — upsell opportunity`,
    );
  }
  if (
    totalBookings > 15 &&
    input.forecast.forecastCovers != null &&
    totalBookings > input.forecast.forecastCovers * 0.7
  ) {
    servicePulseInsights.push("Heavy booking day — check walk-in capacity");
  }

  // ── Suggested Playbook ────────────────────────────────────────────────
  const suggestedPlaybook: string[] = [];
  // Service-blocking maintenance first
  if (input.maintenance.serviceBlocking && input.maintenance.topIssue) {
    suggestedPlaybook.push(`Fix ${input.maintenance.topIssue}`);
  }
  // Critical inventory
  if (input.inventory.criticalCount > 0) {
    suggestedPlaybook.push(
      "Emergency order for critical stock or 86 affected dishes",
    );
  }
  // Compliance
  if ((input.compliance.criticalMissing ?? 0) > 0) {
    suggestedPlaybook.push("Schedule expired compliance renewals");
  }
  // Labour
  if (
    input.labour.labourPercent >
    input.labour.targetPercent + 5
  ) {
    suggestedPlaybook.push("Review roster — consider cutting 1 position");
  }
  // Prep check
  if (
    input.forecast.timeToPeakMinutes != null &&
    input.forecast.timeToPeakMinutes <= 90
  ) {
    suggestedPlaybook.push("Confirm prep completion and FOH briefing");
  }
  // Limit to 5
  suggestedPlaybook.splice(5);

  // ── Operating Score Breakdown ─────────────────────────────────────────
  const operatingScoreBreakdown: EvaluateOperationsOutput["operatingScoreBreakdown"] =
    [];

  // Revenue (25 pts)
  const revScore =
    input.revenue.variancePercent >= 0
      ? 25
      : Math.max(0, 25 + Math.round(input.revenue.variancePercent * 0.5));
  operatingScoreBreakdown.push({
    label: "Revenue",
    score: revScore,
    maxScore: 25,
    reason:
      input.revenue.variancePercent >= 0
        ? "On or above target"
        : `${pct(input.revenue.variancePercent)} behind target`,
  });

  // Labour (20 pts)
  const labDiff = input.labour.labourPercent - input.labour.targetPercent;
  const labScore =
    labDiff <= 0 ? 20 : Math.max(0, 20 - Math.round(labDiff * 1.5));
  operatingScoreBreakdown.push({
    label: "Labour",
    score: labScore,
    maxScore: 20,
    reason:
      labDiff <= 0
        ? "On or below target"
        : `${pct(labDiff)} over target`,
  });

  // Compliance (20 pts)
  const compScore = Math.round(
    (input.compliance.currentPercent / 100) * 20,
  );
  operatingScoreBreakdown.push({
    label: "Compliance",
    score: compScore,
    maxScore: 20,
    reason:
      input.compliance.currentPercent >= 95
        ? "Strong compliance"
        : `${input.compliance.currentPercent.toFixed(0)}% compliant`,
  });

  // Inventory (15 pts)
  const invScore =
    input.inventory.criticalCount > 0
      ? 0
      : input.inventory.lowCount > 3
        ? 5
        : input.inventory.lowCount > 0
          ? 10
          : 15;
  operatingScoreBreakdown.push({
    label: "Inventory",
    score: invScore,
    maxScore: 15,
    reason:
      input.inventory.criticalCount > 0
        ? "Critical stockouts"
        : input.inventory.lowCount > 0
          ? `${input.inventory.lowCount} items low`
          : "All stock healthy",
  });

  // Maintenance (10 pts)
  const mntScore = input.maintenance.serviceBlocking
    ? 0
    : input.maintenance.urgentIssues > 0
      ? 4
      : input.maintenance.openIssues > 0
        ? 7
        : 10;
  operatingScoreBreakdown.push({
    label: "Maintenance",
    score: mntScore,
    maxScore: 10,
    reason: input.maintenance.serviceBlocking
      ? "Service blocking issue"
      : input.maintenance.urgentIssues > 0
        ? `${input.maintenance.urgentIssues} urgent issue${input.maintenance.urgentIssues > 1 ? "s" : ""}`
        : "No urgent issues",
  });

  // Data Health (10 pts)
  const dataScore =
    dataHealth.status === "good"
      ? 10
      : dataHealth.status === "warning"
        ? 6
        : 2;
  operatingScoreBreakdown.push({
    label: "Data Health",
    score: dataScore,
    maxScore: 10,
    reason: dataHealth.summary,
  });

  return {
    operatingCommandBar,
    sinceLastCheck,
    commandFeed,
    whatToDoNow,
    businessStatus,
    dataHealth,
    servicePulseInsights,
    suggestedPlaybook,
    operatingScoreBreakdown,
  };
}
