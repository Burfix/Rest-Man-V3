/**
 * ServiceBriefCard — Today's Service Brief
 *
 * The GM's digital pre-shift briefing. Revenue picture, booking breakdown,
 * event tonight, and service focus prompts. Right card of the risk/brief grid.
 *
 * Think: airport duty officer's morning brief — calm, precise, actionable.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  TodayBookingsSummary,
  VenueEvent,
  RevenueForecast,
} from "@/types";
import type { NormalizedSalesSnapshot } from "@/lib/sales/types";

interface Props {
  today:          TodayBookingsSummary;
  events:         VenueEvent[];
  forecast:       RevenueForecast | null;
  date:           string;
  servicePeriod:  string;
  salesSnapshot?: NormalizedSalesSnapshot | null;
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, "0")}${ampm}`;
}

export default function ServiceBriefCard({
  today,
  events,
  forecast,
  date,
  servicePeriod,
  salesSnapshot,
}: Props) {
  const ss = salesSnapshot ?? null;
  const todayEvent = events.find((e) => e.event_date === date && !e.cancelled);

  const lunchBkgs = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 11 && h < 16;
  });
  const dinnerBkgs = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 16;
  });
  const lunchCovers  = lunchBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);
  const dinnerCovers = dinnerBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);

  // Revenue — prefer snapshot, fall back to forecast
  const revSales      = ss ? ss.netSales : forecast?.forecast_sales ?? null;
  const hasTarget     = ss ? ss.targetSales != null : forecast?.target_sales != null;
  const isAutoTarget  = ss ? ss.targetSource === "auto" : forecast?.target_source === "auto";
  const targetSales   = ss ? ss.targetSales : forecast?.target_sales ?? null;
  const variance      = ss ? ss.targetVarianceAmount : forecast?.sales_gap ?? null;
  const gapPos        = variance != null && variance >= 0;
  const gapNeg        = variance != null && variance < 0;
  const walkInNeed    = ss ? ss.walkInRecoveryNeeded : (gapNeg && forecast?.sales_gap != null ? Math.abs(forecast.sales_gap) : null);
  const progressPct   = ss ? ss.forecastProgressPercent : (
    hasTarget && targetSales && targetSales > 0 && revSales != null
      ? Math.min(100, Math.round((revSales / targetSales) * 100))
      : null
  );
  const lastYearSales = ss ? ss.sameDayLastYearSales : forecast?.last_year_sales ?? null;
  const sourceLabel   = ss ? ss.sourceLabel : null;

  const topRec    = (forecast?.recommendations ?? [])[0] ?? null;
  const recCount  = (forecast?.recommendations ?? []).length;
  const laborPct  = null as number | null;

  const isWalkInCritical =
    (lunchBkgs.length === 0 || dinnerBkgs.length === 0) ||
    (walkInNeed != null && walkInNeed > 2000);

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Today&apos;s Service Brief
        </h2>
        <span className="text-[11px] text-stone-500 dark:text-stone-600">
          {servicePeriod}
        </span>
      </div>

      <div className="flex-1 divide-y divide-stone-100 dark:divide-stone-800">

        {/* ── Revenue ── */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600">
              Revenue
            </p>
            {sourceLabel && (
              <span className={cn(
                "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded ring-1 ring-inset leading-none",
                ss?.isLive  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : ss?.source === "manual" ? "bg-sky-50 text-sky-700 ring-sky-200"
                : "bg-violet-50 text-violet-700 ring-violet-200"
              )}>
                {sourceLabel}
              </span>
            )}
          </div>

          {/* Revenue headline */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-bold text-stone-900 dark:text-stone-100">
                {revSales != null ? formatCurrency(revSales) : "No data available"}
              </p>
              {hasTarget && variance != null && (
                <p className={cn(
                  "mt-0.5 text-[11px] font-medium",
                  gapPos  ? "text-emerald-600 dark:text-emerald-400"
                          : Math.abs(variance) / (targetSales || 1) >= 0.2
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-400"
                )}>
                  {gapPos
                    ? `Ahead of target · +${formatCurrency(variance)}`
                    : gapNeg
                    ? `Behind target · −${formatCurrency(Math.abs(variance))}`
                    : "On target"}
                </p>
              )}
            </div>
            {!hasTarget && (
              <Link
                href="/dashboard/settings/targets"
                className="shrink-0 text-[11px] font-semibold text-stone-500 dark:text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors whitespace-nowrap"
              >
                Set target →
              </Link>
            )}
          </div>

          {/* Last year baseline + today's target */}
          <div className="space-y-1 mb-3">
            {lastYearSales != null ? (
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-500 dark:text-stone-600">Last year (same day)</span>
                <span className="font-medium text-stone-600 dark:text-stone-400">
                  {formatCurrency(lastYearSales)}
                </span>
              </div>
            ) : null}
            {hasTarget && targetSales != null && (
              <div className="flex justify-between text-[11px]">
                <span className="text-stone-500 dark:text-stone-600">
                  Today&apos;s target
                  {isAutoTarget && (
                    <span className="ml-1 text-stone-600 dark:text-stone-700">(same day +10%)</span>
                  )}
                </span>
                <span className="font-medium text-stone-600 dark:text-stone-400">
                  {formatCurrency(targetSales)}
                </span>
              </div>
            )}
          </div>

          {/* Progress bar toward target */}
          {progressPct != null && (
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-stone-500 dark:text-stone-600">
                  {ss?.source === "forecast" ? "Forecast progress" : "Progress to target"}
                </span>
                <span className={cn(
                  "font-semibold",
                  progressPct >= 100 ? "text-emerald-600 dark:text-emerald-400"
                  : progressPct >= 75 ? "text-sky-600 dark:text-sky-400"
                  : progressPct >= 50 ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400"
                )}>
                  {progressPct}% of target reached
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    progressPct >= 100 ? "bg-emerald-500"
                    : progressPct >= 75 ? "bg-sky-500"
                    : progressPct >= 50 ? "bg-amber-400"
                    : "bg-red-500"
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Walk-in gap warning */}
          {walkInNeed != null && (
            <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Walk-in need: {formatCurrency(walkInNeed)} to close gap
            </p>
          )}
        </div>

        {/* ── Bookings ── */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-2">
            Bookings
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={cn(
                "text-xs font-semibold",
                lunchBkgs.length > 0 ? "text-stone-800 dark:text-stone-200" : "text-amber-600 dark:text-amber-400"
              )}>
                {lunchBkgs.length > 0 ? `${lunchBkgs.length} lunch booking${lunchBkgs.length > 1 ? "s" : ""}` : "No lunch bookings"}
              </p>
              <p className="text-[11px] text-stone-500 dark:text-stone-600 mt-0.5">
                {lunchBkgs.length > 0
                  ? `${lunchCovers} cover${lunchCovers !== 1 ? "s" : ""} · 12:00–15:00`
                  : "Walk-in trade important · 12:00–15:00"}
              </p>
            </div>
            <div>
              <p className={cn(
                "text-xs font-semibold",
                dinnerBkgs.length > 0 ? "text-stone-800 dark:text-stone-200" : "text-amber-600 dark:text-amber-400"
              )}>
                {dinnerBkgs.length > 0 ? `${dinnerBkgs.length} dinner booking${dinnerBkgs.length > 1 ? "s" : ""}` : "No dinner bookings"}
              </p>
              <p className="text-[11px] text-stone-500 dark:text-stone-600 mt-0.5">
                {dinnerBkgs.length > 0
                  ? `${dinnerCovers} cover${dinnerCovers !== 1 ? "s" : ""} · 18:00–22:00`
                  : "Push walk-ins from 18:00"}
              </p>
            </div>
          </div>
        </div>

        {/* ── Event tonight ── */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-1.5">
            Event Tonight
          </p>
          {todayEvent ? (
            <>
              <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                {todayEvent.name}
              </p>
              <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-500">
                {todayEvent.start_time
                  ? `Starts ${fmtTime(todayEvent.start_time)} — brief FOH and confirm staffing`
                  : "Time to be confirmed — brief front-of-house team"}
              </p>
            </>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-600">
              No event scheduled · standard service tonight
            </p>
          )}
        </div>

        {/* ── Service focus ── */}
        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-1.5">
            Service Focus
          </p>
          {topRec ? (
            <>
              <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                {topRec.description}
              </p>
              {recCount > 1 && (
                <Link
                  href="/dashboard/settings/targets"
                  className="mt-1 inline-block text-[11px] text-stone-500 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
                >
                  +{recCount - 1} more suggestion{recCount > 2 ? "s" : ""} →
                </Link>
              )}
            </>
          ) : isWalkInCritical ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              Walk-in trade will be important today. Ensure FOH is maximising covers and
              greeting guests actively.
            </p>
          ) : laborPct != null && laborPct > 35 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              Labour cost is elevated at {laborPct.toFixed(1)}%. Review shift coverage
              before peak service.
            </p>
          ) : (
            <p className="text-xs text-stone-500 dark:text-stone-600">
              Set a revenue target to unlock AI-powered service recommendations.
            </p>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3">
        <Link
          href="/dashboard/bookings"
          className="text-[11px] font-medium text-stone-500 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
        >
          View all bookings →
        </Link>
      </div>

    </div>
  );
}
