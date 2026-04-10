/**
 * TodayAtVenueCard — Live venue activity at a glance
 *
 * Compact data rows for service periods, labour, exceptions, and covers.
 * Left card of the today/health grid. Replaces TodayOpsPanel.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import SourceBadge from "@/components/ui/SourceBadge";
import type { SourceType } from "@/components/ui/SourceBadge";
import { generateLabourInsight } from "@/lib/commandCenter";
import type {
  TodayBookingsSummary,
  VenueEvent,
  MaintenanceSummary,
  RevenueForecast,
} from "@/types";
import type { NormalizedSalesSnapshot } from "@/lib/sales/types";

interface Props {
  today:          TodayBookingsSummary;
  events:         VenueEvent[];
  maintenance:    MaintenanceSummary;
  date:           string;
  forecast?:      RevenueForecast | null;
  microsSource?:  SourceType | null;
  microsSyncedAt?: string | null;
  salesSnapshot?: NormalizedSalesSnapshot | null;
}

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, "0")}${ampm}`;
}

function DataRow({
  label,
  value,
  sub,
  valueColor = "text-stone-800 dark:text-stone-200",
  badge,
}: {
  label:       string;
  value:       string;
  sub?:        string;
  valueColor?: string;
  badge?:      { text: string; cls: string };
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-0 gap-3">
      <span className="text-[11px] font-medium text-stone-500 dark:text-stone-500 shrink-0">
        {label}
      </span>
      <div className="text-right flex-1 min-w-0">
        <div className="flex items-center justify-end gap-1.5">
          {badge && (
            <span className={cn(
              "rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide leading-none",
              badge.cls
            )}>
              {badge.text}
            </span>
          )}
          <span className={cn("text-xs font-semibold", valueColor)}>{value}</span>
        </div>
        {sub && (
          <p className="text-[10px] text-stone-500 dark:text-stone-600 leading-none mt-px">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function TodayAtVenueCard({
  today,
  events,
  maintenance,
  date,
  forecast,
  microsSource,
  microsSyncedAt,
  salesSnapshot,
}: Props) {
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

  const laborPct = null as number | null;
  const laborColor =
    laborPct == null ? "text-stone-500 dark:text-stone-600"       :
    laborPct > 45    ? "text-red-600 dark:text-red-400"           :
    laborPct > 35    ? "text-amber-600 dark:text-amber-400"       :
    "text-emerald-600 dark:text-emerald-500";

  const laborBadge =
    laborPct != null && laborPct > 45
      ? { text: "High",     cls: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400" }
    : laborPct != null && laborPct > 35
      ? { text: "Elevated", cls: "bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400" }
    : undefined;

  // Labour intelligence
  const labourInsight = laborPct != null
    ? generateLabourInsight({ laborPct, serviceFraction: 0.5 })
    : null;

  const walkIn =
    salesSnapshot?.walkInRecoveryNeeded != null ? salesSnapshot.walkInRecoveryNeeded
    : forecast?.sales_gap != null && forecast.sales_gap < 0 ? Math.abs(forecast.sales_gap)
    : null;

  // Source badge for revenue data — prefer snapshot
  let revenueSource: SourceType | null = null;
  let revenueAgeLabel: string | undefined;
  if (salesSnapshot) {
    revenueSource =
      salesSnapshot.source === "micros" && salesSnapshot.isLive ? "micros_live"
      : salesSnapshot.source === "micros" && salesSnapshot.isStale ? "stale"
      : salesSnapshot.source === "manual" ? "manual_upload"
      : salesSnapshot.source === "forecast" ? "forecast"
      : null;
    if (salesSnapshot.freshnessMinutes != null) {
      revenueAgeLabel = salesSnapshot.freshnessMinutes < 1 ? "now"
        : salesSnapshot.freshnessMinutes < 60 ? `${salesSnapshot.freshnessMinutes}m`
        : `${Math.floor(salesSnapshot.freshnessMinutes / 60)}h`;
    }
  } else if (microsSource === "micros_live" && microsSyncedAt) {
    revenueSource = "micros_live";
    const mins = Math.floor((Date.now() - new Date(microsSyncedAt).getTime()) / 60_000);
    revenueAgeLabel = mins < 1 ? "now" : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
  } else if (forecast) {
    revenueSource = "forecast";
  }

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
            Today at Venue
          </h2>
          {revenueSource && (
            <SourceBadge source={revenueSource} ageLabel={revenueAgeLabel} />
          )}
        </div>
        <Link
          href="/dashboard/bookings"
          className="text-[11px] text-stone-500 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
        >
          All bookings →
        </Link>
      </div>

      {/* Rows */}
      <div className="flex-1 px-5">
        <DataRow
          label="Lunch service"
          value={lunchBkgs.length > 0 ? `${lunchBkgs.length} booking${lunchBkgs.length > 1 ? "s" : ""}` : "No bookings yet"}
          sub={lunchBkgs.length > 0 ? `${lunchCovers} covers · 12:00–15:00` : "Walk-in trade important · 12:00–15:00"}
          valueColor={lunchBkgs.length > 0 ? "text-stone-800 dark:text-stone-200" : "text-amber-600 dark:text-amber-400"}
        />
        <DataRow
          label="Dinner service"
          value={dinnerBkgs.length > 0 ? `${dinnerBkgs.length} booking${dinnerBkgs.length > 1 ? "s" : ""}` : "No bookings yet"}
          sub={dinnerBkgs.length > 0 ? `${dinnerCovers} covers · 18:00–22:00` : "Walk-in trade important · 18:00–22:00"}
          valueColor={dinnerBkgs.length > 0 ? "text-stone-800 dark:text-stone-200" : "text-amber-600 dark:text-amber-400"}
        />
        <DataRow
          label="Event tonight"
          value={
            todayEvent
              ? `${todayEvent.name.slice(0, 24)}${todayEvent.name.length > 24 ? "…" : ""}`
              : "None scheduled"
          }
          sub={todayEvent?.start_time ? `Starts ${fmtTime(todayEvent.start_time)}` : undefined}
          valueColor={todayEvent ? "text-stone-800 dark:text-stone-200" : "text-stone-500 dark:text-stone-600"}
        />
        <DataRow
          label="Labour cost"
          value={laborPct != null ? `${laborPct.toFixed(1)}%` : "—"}
          sub={
            labourInsight
              ? labourInsight.interpretation
              : laborPct != null ? "of revenue" : "No labour data"
          }
          valueColor={laborColor}
          badge={laborBadge}
        />
        {labourInsight?.recommendation && (
          <div className="flex items-start gap-2 py-2.5 border-b border-stone-100 dark:border-stone-800">
            <span className="mt-0.5 h-1 w-1 rounded-full bg-amber-400 shrink-0" />
            <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
              {labourInsight.recommendation}
              {labourInsight.projectedClose && (
                <span className="ml-1 text-stone-500 dark:text-stone-600">
                  — projected close {labourInsight.projectedClose.toFixed(1)}%
                </span>
              )}
            </p>
          </div>
        )}
        {walkIn != null && (
          <DataRow
            label="Walk-in need"
            value={formatCurrency(walkIn)}
            sub="to reach today's revenue target"
            valueColor="text-amber-600 dark:text-amber-400"
          />
        )}
        {today.escalationsToday > 0 && (
          <DataRow
            label="Escalations"
            value={`${today.escalationsToday} require${today.escalationsToday === 1 ? "s" : ""} attention`}
            valueColor="text-red-600 dark:text-red-400"
            badge={{ text: "Urgent", cls: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400" }}
          />
        )}
        {maintenance.outOfService > 0 && (
          <DataRow
            label="Equipment"
            value={`${maintenance.outOfService} out of service`}
            sub={maintenance.urgentIssues[0]?.unit_name}
            valueColor="text-red-600 dark:text-red-400"
            badge={{ text: "Out of SVC", cls: "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400" }}
          />
        )}
      </div>

      {/* Footer totals */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3 flex items-center justify-between">
        <span className="text-[11px] text-stone-500 dark:text-stone-500">Total today</span>
        <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
          {today.total} booking{today.total !== 1 ? "s" : ""} · {today.totalCovers} covers
        </span>
      </div>

    </div>
  );
}
