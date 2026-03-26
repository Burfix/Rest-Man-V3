/**
 * OperationalHealthCard — Restaurant Operational Health Score
 *
 * Headline score (0–100) with a status label, then 4 sub-dimension bars:
 *   Compliance · Maintenance · Revenue Readiness · Service Readiness
 *
 * Below the score: top risk driver, fastest fix, and data freshness note.
 *
 * Revenue and Service bars handle missing-data gracefully — never show 0%
 * as though something is broken when data simply hasn't been set up yet.
 *
 * Right card of the today/health grid. Replaces OperationalHealth.
 */

import { cn } from "@/lib/utils";
import { computeHealthScore } from "@/lib/commandCenter";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  SevenDayReviewSummary,
} from "@/types";
import type { NormalizedSalesSnapshot } from "@/lib/sales/types";

interface Props {
  compliance:   ComplianceSummary;
  maintenance:  MaintenanceSummary;
  forecast:     RevenueForecast | null;
  reviews:      SevenDayReviewSummary;
  salesSnapshot?: NormalizedSalesSnapshot | null;
  microsStatus?: {
    minutesSinceSync:    number | null;
    isConfigured:        boolean;
    isLiveDataAvailable?: boolean;
    lastSyncError?:      string | null;
  } | null;
  freshness?: {
    sales:   { lastUpdated: string | null; stale: boolean } | null;
    labour?: { lastUpdated: string | null; stale: boolean } | null;
  } | null;
}

export default function OperationalHealthCard({
  compliance,
  maintenance,
  forecast,
  reviews,
  salesSnapshot,
  microsStatus,
  freshness,
}: Props) {
  const { total, status, breakdown } = computeHealthScore({
    compliance,
    maintenance,
    forecast,
    reviews,
  });

  // ── Guidance: top risk driver + fastest fix ────────────────────────────
  let topRiskDriver: string | null = null;
  let fastestFix:    string | null = null;

  if (compliance.expired > 0) {
    topRiskDriver = `${compliance.expired} compliance certificate${compliance.expired > 1 ? "s" : ""} expired`;
    fastestFix    = "Upload renewed certificates to Compliance Hub";
  } else if (maintenance.foodSafetyRisks > 0) {
    topRiskDriver = `Food safety issue — ${maintenance.urgentIssues[0]?.unit_name ?? "equipment"}`;
    fastestFix    = "Resolve food safety issue before next service";
  } else if (maintenance.outOfService > 0) {
    topRiskDriver = `${maintenance.outOfService} equipment unit${maintenance.outOfService > 1 ? "s" : ""} out of service`;
    fastestFix    = "Assign repair or source replacement unit";
  } else if (forecast?.sales_gap_pct && forecast.sales_gap_pct < -20) {
    const ss = salesSnapshot;
    const gapPct = ss?.targetVariancePercent != null ? Math.abs(ss.targetVariancePercent) : Math.abs(forecast.sales_gap_pct);
    const gap = ss?.walkInRecoveryNeeded ?? Math.abs(Math.round(forecast.sales_gap ?? 0));
    topRiskDriver = `Revenue pace ${gapPct.toFixed(0)}% behind target`;
    fastestFix    = gap > 0
      ? `Need R${gap.toLocaleString()} additional covers at current average spend`
      : "Push walk-ins and confirm open bookings";
  } else if (maintenance.openRepairs > 0) {
    topRiskDriver = `${maintenance.openRepairs} open repair issue${maintenance.openRepairs > 1 ? "s" : ""}`;
    fastestFix    = "Assign staff and update repair status before service";
  } else if (compliance.due_soon > 0) {
    topRiskDriver = `${compliance.due_soon} certificate${compliance.due_soon > 1 ? "s" : ""} expiring within 30 days`;
    fastestFix    = "Begin renewal — allow 2–4 weeks for authority processing";
  }

  // ── Freshness / confidence note ────────────────────────────────────────
  const freshnessNotes: string[] = [];
  if (salesSnapshot && salesSnapshot.source !== "forecast") {
    const m = salesSnapshot.freshnessMinutes;
    const srcLabel = salesSnapshot.source === "micros" ? "Live POS" : "Manual upload";
    freshnessNotes.push(
      m != null
        ? `${srcLabel} synced ${m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`}`
        : `${srcLabel} data active`
    );
  } else if (microsStatus?.isLiveDataAvailable === true && microsStatus.minutesSinceSync != null) {
    const m = microsStatus.minutesSinceSync;
    freshnessNotes.push(`Live POS synced ${m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`}`);
  } else if (microsStatus?.isConfigured && microsStatus.lastSyncError) {
    freshnessNotes.push("POS feed unavailable — using latest saved values");
  }
  if (freshness?.sales?.lastUpdated && !(salesSnapshot && salesSnapshot.source !== "forecast")) {
    const d = Math.round((Date.now() - new Date(freshness.sales.lastUpdated).getTime()) / 86_400_000);
    if (d > 0) freshnessNotes.push(`Sales data ${d}d old`);
  }
  if (freshnessNotes.length === 0 && !microsStatus?.isLiveDataAvailable) {
    freshnessNotes.push("Using latest available data — connect POS for live scoring");
  }

  const statusCfg = {
    "Strong":           { color: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-200 dark:border-emerald-800" },
    "Stable":           { color: "text-sky-600 dark:text-sky-400",         bar: "bg-sky-500",     ring: "border-sky-200 dark:border-sky-800" },
    "Attention Needed": { color: "text-amber-600 dark:text-amber-400",     bar: "bg-amber-400",   ring: "border-stone-200 dark:border-stone-800" },
    "High Risk":        { color: "text-red-600 dark:text-red-400",         bar: "bg-red-500",     ring: "border-stone-200 dark:border-stone-800" },
  };
  const cfg = statusCfg[status];

  const hasForecast = !!forecast;
  const hasTarget   = forecast?.target_sales != null;
  const hasOpsData  = false;
  const isAutoTarget = forecast?.target_source === "auto";

  // Revenue bar: three states — no forecast, no target (and no auto-derivable), scored
  const revIsSetup  = hasForecast && hasTarget;
  const revLabel =
    !hasForecast ? "No forecast data" :
    !hasTarget   ? "Target unavailable" :
    isAutoTarget && breakdown.revenue >= 85 ? "Ahead of target" :
    isAutoTarget && breakdown.revenue >= 70 ? "On track" :
    isAutoTarget && breakdown.revenue >= 50 ? "Behind target" :
    isAutoTarget                            ? "Well behind target" :
    breakdown.revenue >= 85 ? "On track" :
    breakdown.revenue >= 70 ? "Slightly below" :
    breakdown.revenue >= 50 ? "Below target" :
    "Significantly below";
  const revValue    =
    !hasForecast ? "No data" :
    !hasTarget   ? "No target" :
    `${breakdown.revenue}%`;
  const revBarColor =
    !revIsSetup                ? "bg-stone-200 dark:bg-stone-700"      :
    breakdown.revenue >= 70    ? "bg-emerald-500"                      :
    breakdown.revenue >= 50    ? "bg-amber-400"                        :
    "bg-red-500";

  // Service readiness bar: based on staffing score from health computation
  const svcLabel =
    !hasOpsData                 ? "No ops data"  :
    breakdown.staffing >= 85    ? "Ready"        :
    breakdown.staffing >= 65    ? "Monitor"      :
    "Attention";
  const svcValue    = !hasOpsData ? "Needs setup" : `${breakdown.staffing}%`;
  const svcBarColor =
    !hasOpsData              ? "bg-stone-200 dark:bg-stone-700" :
    breakdown.staffing >= 65 ? "bg-emerald-500"                 :
    breakdown.staffing >= 45 ? "bg-amber-400"                   :
    "bg-red-500";

  const bars = [
    {
      label:    "Compliance",
      value:    compliance.total > 0 ? `${breakdown.compliance}%` : "—",
      status:   compliance.total === 0 ? "Not configured"   :
                compliance.expired > 0  ? "Action required" :
                compliance.due_soon > 0 ? "Due soon"        :
                "Current",
      barColor: compliance.expired > 0   ? "bg-red-500"   :
                compliance.due_soon > 0  ? "bg-amber-400" :
                compliance.total === 0   ? "bg-stone-200 dark:bg-stone-700" :
                "bg-emerald-500",
      pct:      compliance.total > 0 ? breakdown.compliance : 0,
      dimmed:   compliance.total === 0,
    },
    {
      label:    "Maintenance",
      value:    maintenance.totalEquipment > 0 ? `${breakdown.maintenance}%` : "—",
      status:   maintenance.totalEquipment === 0 ? "Not configured" :
                maintenance.outOfService > 0     ? "Out of service" :
                (maintenance.openRepairs + maintenance.inProgress) > 0 ? "Issues open" :
                "Operational",
      barColor: maintenance.outOfService > 0                                    ? "bg-red-500"   :
                (maintenance.openRepairs + maintenance.inProgress) > 0          ? "bg-amber-400" :
                maintenance.totalEquipment === 0                                ? "bg-stone-200 dark:bg-stone-700" :
                "bg-emerald-500",
      pct:      maintenance.totalEquipment > 0 ? breakdown.maintenance : 0,
      dimmed:   maintenance.totalEquipment === 0,
    },
    {
      label:    isAutoTarget ? "Revenue (target: same day +10%)" : "Revenue",
      value:    revValue,
      status:   revLabel,
      barColor: revBarColor,
      pct:      revIsSetup ? breakdown.revenue : 20, // show faint bar for setup prompt
      dimmed:   !revIsSetup,
    },
    {
      label:    "Service Readiness",
      value:    svcValue,
      status:   svcLabel,
      barColor: svcBarColor,
      pct:      hasOpsData ? breakdown.staffing : 20,
      dimmed:   !hasOpsData,
    },
  ];

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Operational Health
        </h2>
      </div>

      {/* Headline score */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <div className="shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn("text-4xl font-black tabular-nums leading-none", cfg.color)}>
              {total}
            </span>
            <span className="text-sm text-stone-400 dark:text-stone-600 font-medium">/100</span>
          </div>
          <p className={cn("text-sm font-semibold mt-1", cfg.color)}>{status}</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="h-2 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
            <div
              className={cn("h-2 rounded-full transition-all duration-700", cfg.bar)}
              style={{ width: `${total}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-stone-400 dark:text-stone-600 leading-tight">
            Compliance · maintenance · revenue · service data
          </p>
        </div>
      </div>

      {/* Sub-score bars */}
      <div className="flex-1 divide-y divide-stone-100 dark:divide-stone-800">
        {bars.map((bar) => {
          const labelColor =
            bar.dimmed              ? "text-stone-400 dark:text-stone-600" :
            "text-stone-600 dark:text-stone-400";

          const statusColor =
            bar.dimmed                            ? "text-stone-400 dark:text-stone-600"   :
            bar.barColor.includes("red-5")        ? "text-red-600 dark:text-red-400"       :
            bar.barColor.includes("amber")        ? "text-amber-600 dark:text-amber-400"   :
            bar.barColor.includes("stone-2") ||
            bar.barColor.includes("stone-7")      ? "text-stone-400 dark:text-stone-600"   :
            "text-emerald-600 dark:text-emerald-500";

          return (
            <div key={bar.label} className="px-5 py-3.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className={cn("text-[11px] font-medium", labelColor)}>
                  {bar.label}
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn("text-[11px] font-medium", statusColor)}>
                    {bar.status}
                  </span>
                  <span className={cn(
                    "text-[11px] font-bold tabular-nums",
                    bar.dimmed ? "text-stone-400 dark:text-stone-600" : "text-stone-700 dark:text-stone-300"
                  )}>
                    {bar.value}
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn("h-1.5 rounded-full transition-all duration-500", bar.barColor)}
                  style={{ width: `${bar.pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Guidance panel — top risk driver + fastest fix */}
      {(topRiskDriver || fastestFix || freshnessNotes.length > 0) && (
        <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3.5 space-y-2">
          {topRiskDriver && (
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Top risk driver</p>
                <p className="text-[11px] text-stone-700 dark:text-stone-300 font-medium leading-snug mt-px">{topRiskDriver}</p>
              </div>
            </div>
          )}
          {fastestFix && (
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Fastest fix</p>
                <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug mt-px">{fastestFix}</p>
              </div>
            </div>
          )}
          {freshnessNotes.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-600">Confidence</p>
                <p className="text-[11px] text-stone-500 dark:text-stone-500 leading-snug mt-px">
                  {freshnessNotes.join(" · ")}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
