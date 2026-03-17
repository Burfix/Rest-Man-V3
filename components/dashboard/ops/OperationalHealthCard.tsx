/**
 * OperationalHealthCard — Restaurant Operational Health Score
 *
 * Headline score (0–100) with a status label, then 4 sub-dimension bars:
 *   Compliance · Maintenance · Revenue Readiness · Service Readiness
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
  DailyOperationsDashboardSummary,
} from "@/types";

interface Props {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
  reviews:     SevenDayReviewSummary;
  dailyOps:    DailyOperationsDashboardSummary;
}

export default function OperationalHealthCard({
  compliance,
  maintenance,
  forecast,
  reviews,
  dailyOps,
}: Props) {
  const { total, status, breakdown } = computeHealthScore({
    compliance,
    maintenance,
    forecast,
    dailyOps,
    reviews,
  });

  const statusCfg = {
    "Strong":           { color: "text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500", ring: "border-emerald-200 dark:border-emerald-800" },
    "Stable":           { color: "text-sky-600 dark:text-sky-400",         bar: "bg-sky-500",     ring: "border-sky-200 dark:border-sky-800" },
    "Attention Needed": { color: "text-amber-600 dark:text-amber-400",     bar: "bg-amber-400",   ring: "border-stone-200 dark:border-stone-800" },
    "High Risk":        { color: "text-red-600 dark:text-red-400",         bar: "bg-red-500",     ring: "border-stone-200 dark:border-stone-800" },
  };
  const cfg = statusCfg[status];

  const hasForecast = !!forecast;
  const hasTarget   = forecast?.target_sales != null;
  const hasOpsData  = !!dailyOps.latestReport;
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

    </div>
  );
}
