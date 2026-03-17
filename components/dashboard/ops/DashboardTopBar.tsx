/**
 * DashboardTopBar — Operations Command Bar
 *
 * Premium identity header with a compact 5-tile KPI row.
 * Replaces CommandStatusBar with richer operational copy and
 * a stronger command-centre aesthetic.
 *
 * Tiles: Compliance · Maintenance · Revenue · Labour · Today
 */

import { cn, formatDisplayDate } from "@/lib/utils";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  DailyOperationsDashboardSummary,
  VenueEvent,
  TodayBookingsSummary,
} from "@/types";

interface Props {
  date:          string;
  servicePeriod: string;
  compliance:    ComplianceSummary;
  maintenance:   MaintenanceSummary;
  forecast:      RevenueForecast | null;
  dailyOps:      DailyOperationsDashboardSummary;
  events:        VenueEvent[];
  today:         TodayBookingsSummary;
  totalAlerts:   number;
}

const PERIOD_STYLE: Record<string, string> = {
  Breakfast:    "bg-amber-100  dark:bg-amber-900/30  text-amber-700  dark:text-amber-400",
  Lunch:        "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  Afternoon:    "bg-sky-100    dark:bg-sky-900/30    text-sky-700    dark:text-sky-400",
  Dinner:       "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400",
  "After Hours":"bg-stone-100  dark:bg-stone-800     text-stone-500  dark:text-stone-400",
};

/** Compact currency — "R 10.4K", "R 1.2M", "R 850" */
function compactZAR(v: number): string {
  if (v >= 1_000_000) return `R ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000)    return `R ${Math.round(v / 1_000)}K`;
  if (v >= 1_000)     return `R ${(v / 1_000).toFixed(1)}K`;
  return `R ${Math.round(v)}`;
}

export default function DashboardTopBar({
  date,
  servicePeriod,
  compliance,
  maintenance,
  forecast,
  dailyOps,
  today,
  totalAlerts,
}: Props) {
  const laborPct  = dailyOps.latestReport?.labor_cost_percent ?? null;
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;

  // ── Compliance tile ─────────────────────────────────────────────────────
  const compMetric = compliance.total > 0 ? `${compliance.compliance_pct}%` : "—";
  const compSub =
    compliance.expired > 0  ? `${compliance.expired} expired`        :
    compliance.due_soon > 0 ? `${compliance.due_soon} due within 30d` :
    compliance.total > 0    ? "All current"                           :
    "No items tracked";
  const compSubColor =
    compliance.expired > 0  ? "text-red-600 dark:text-red-400"     :
    compliance.due_soon > 0 ? "text-amber-600 dark:text-amber-400" :
    compliance.total > 0    ? "text-emerald-600 dark:text-emerald-500" :
    "text-stone-400 dark:text-stone-600";

  // ── Maintenance tile ─────────────────────────────────────────────────────
  const maintMetric = maintenance.totalEquipment > 0 ? String(totalOpen) : "—";
  const maintMetricSub = maintenance.totalEquipment > 0 ? (totalOpen === 1 ? "open issue" : "open issues") : undefined;
  const maintSub =
    maintenance.outOfService > 0  ? `${maintenance.outOfService} out of service` :
    totalOpen > 0                  ? `${maintenance.totalEquipment} units tracked` :
    maintenance.totalEquipment > 0 ? `${maintenance.totalEquipment} units operational` :
    "No equipment tracked";
  const maintSubColor =
    maintenance.outOfService > 0  ? "text-red-600 dark:text-red-400"     :
    totalOpen > 0                  ? "text-amber-600 dark:text-amber-400" :
    maintenance.totalEquipment > 0 ? "text-emerald-600 dark:text-emerald-500" :
    "text-stone-400 dark:text-stone-600";

  // ── Revenue tile ─────────────────────────────────────────────────────────
  const revMetric = forecast ? compactZAR(forecast.forecast_sales) : "—";
  const revSub =
    !forecast                              ? "No forecast available"  :
    !forecast.target_sales                 ? "Target not set"         :
    (forecast.sales_gap_pct ?? 0) >= 0     ? "On target"             :
    Math.abs(forecast.sales_gap_pct ?? 0) >= 20
      ? `${Math.abs(forecast.sales_gap_pct ?? 0).toFixed(0)}% below target`
      : `${Math.abs(forecast.sales_gap_pct ?? 0).toFixed(0)}% below target`;
  const revSubColor =
    !forecast                              ? "text-stone-400 dark:text-stone-600" :
    !forecast.target_sales                 ? "text-amber-600 dark:text-amber-400" :
    (forecast.sales_gap_pct ?? 0) >= 0     ? "text-emerald-600 dark:text-emerald-500" :
    Math.abs(forecast.sales_gap_pct ?? 0) >= 20 ? "text-red-600 dark:text-red-400" :
    "text-amber-600 dark:text-amber-400";

  // ── Labour tile ───────────────────────────────────────────────────────────
  const labourMetric = laborPct != null ? `${laborPct.toFixed(1)}%` : "—";
  const labourSub =
    laborPct == null ? "No report uploaded"   :
    laborPct <= 30   ? "Well within range"    :
    laborPct <= 35   ? "Healthy"              :
    laborPct <= 45   ? "Elevated — monitor"   :
    "High — take action";
  const labourSubColor =
    laborPct == null ? "text-stone-400 dark:text-stone-600"       :
    laborPct <= 35   ? "text-emerald-600 dark:text-emerald-500"   :
    laborPct <= 45   ? "text-amber-600 dark:text-amber-400"       :
    "text-red-600 dark:text-red-400";

  // ── Today tile ────────────────────────────────────────────────────────────
  const todaySub =
    today.total > 0
      ? `${today.totalCovers} cover${today.totalCovers !== 1 ? "s" : ""} confirmed`
      : "Walk-in trade important";
  const todaySubColor =
    today.total > 0
      ? "text-stone-500 dark:text-stone-500"
      : "text-amber-600 dark:text-amber-400";

  const kpis = [
    {
      label:      "Compliance",
      metric:     compMetric,
      sub:        compSub,
      subColor:   compSubColor,
      href:       "/dashboard/compliance",
    },
    {
      label:      "Maintenance",
      metric:     maintMetric,
      metricSub:  maintMetricSub,
      sub:        maintSub,
      subColor:   maintSubColor,
      href:       "/dashboard/maintenance",
    },
    {
      label:      "Revenue",
      metric:     revMetric,
      sub:        revSub,
      subColor:   revSubColor,
      href:       "/dashboard/settings/targets",
    },
    {
      label:      "Labour",
      metric:     labourMetric,
      sub:        labourSub,
      subColor:   labourSubColor,
      href:       "/dashboard/operations",
    },
    {
      label:      "Today",
      metric:     String(today.total),
      metricSub:  today.total === 1 ? "booking" : "bookings",
      sub:        todaySub,
      subColor:   todaySubColor,
      href:       "/dashboard/bookings",
    },
  ];

  const periodStyle = PERIOD_STYLE[servicePeriod] ?? PERIOD_STYLE["After Hours"];

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* ── Identity bar ── */}
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm font-bold tracking-tight text-stone-900 dark:text-stone-100">
            Si Cantina Sociale
          </span>
          <span className="text-stone-300 dark:text-stone-700 text-xs">·</span>
          <span className="hidden sm:inline text-xs text-stone-500 dark:text-stone-500">
            Operations Command
          </span>
          {totalAlerts > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-px text-[10px] font-bold text-white leading-none">
              <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
              {totalAlerts} alert{totalAlerts > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="hidden sm:inline text-[11px] text-stone-400 dark:text-stone-600">
            {formatDisplayDate(date)}
          </span>
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            periodStyle
          )}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
            {servicePeriod}
          </span>
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y divide-stone-100 dark:divide-stone-800">
        {kpis.map((kpi) => (
          <a
            key={kpi.label}
            href={kpi.href}
            className="flex flex-col gap-1 px-4 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors group"
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-600 group-hover:text-stone-500 dark:group-hover:text-stone-400">
              {kpi.label}
            </span>
            <div className="flex items-baseline gap-1 leading-none">
              <span className="text-xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
                {kpi.metric}
              </span>
              {kpi.metricSub && (
                <span className="text-[11px] text-stone-400 dark:text-stone-600">
                  {kpi.metricSub}
                </span>
              )}
            </div>
            <span className={cn("text-[11px] font-medium leading-tight truncate", kpi.subColor)}>
              {kpi.sub}
            </span>
          </a>
        ))}
      </div>

    </div>
  );
}
