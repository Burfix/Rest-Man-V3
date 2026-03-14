/**
 * TodayOpsPanel — "Today at Venue" compact card
 *
 * Left card of the secondary operations grid.
 * Compact rows: Lunch · Dinner · Event · Labour cost · Escalations
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  TodayBookingsSummary,
  VenueEvent,
  DailyOperationsDashboardSummary,
  MaintenanceSummary,
  RevenueForecast,
} from "@/types";

interface Props {
  today:       TodayBookingsSummary;
  events:      VenueEvent[];
  dailyOps:    DailyOperationsDashboardSummary;
  maintenance: MaintenanceSummary;
  date:        string; // YYYY-MM-DD
  forecast?:   RevenueForecast | null;
}

function fmtTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, "0")}${ampm}`;
}

// A single compact data row
function Row({
  label,
  value,
  valueColor = "text-stone-800",
  sub,
}: {
  label:       string;
  value:       string;
  valueColor?: string;
  sub?:        string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-0">
      <span className="text-[11px] font-medium text-stone-500">{label}</span>
      <div className="text-right">
        <span className={cn("text-xs font-semibold", valueColor)}>{value}</span>
        {sub && <p className="text-[10px] text-stone-400 leading-none mt-px">{sub}</p>}
      </div>
    </div>
  );
}

export default function TodayOpsPanel({
  today,
  events,
  dailyOps,
  maintenance,
  date,
  forecast,
}: Props) {
  const todayEvent = events.find((e) => e.event_date === date && !e.cancelled);
  const report     = dailyOps.latestReport;

  // Split bookings by service period
  const lunchBkgs  = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 11 && h < 16;
  });
  const dinnerBkgs = today.bookings.filter((b) => {
    const h = parseInt((b.booking_time ?? "00:00").split(":")[0], 10);
    return h >= 16;
  });
  const lunchCovers  = lunchBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);
  const dinnerCovers = dinnerBkgs.reduce((s, b) => s + (b.guest_count ?? 0), 0);

  const laborPct   = report?.labor_cost_percent ?? null;
  const laborColor =
    laborPct == null   ? "text-stone-400" :
    laborPct > 45      ? "text-red-600"   :
    laborPct > 35      ? "text-amber-600" :
    "text-emerald-700";

  // Revenue walk-in need
  const walkIn     = forecast?.sales_gap != null && forecast.sales_gap < 0
    ? Math.abs(forecast.sales_gap)
    : null;

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-xs font-semibold text-stone-700 dark:text-stone-300">Today at Venue</h2>
        <Link href="/dashboard/bookings" className="text-[11px] text-stone-400 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
          All bookings →
        </Link>
      </div>

      {/* Rows */}
      <div className="flex-1 px-5">
        <Row
          label="Lunch"
          value={`${lunchBkgs.length} bookings`}
          sub={`${lunchCovers} covers · 12:00–15:00`}
          valueColor={lunchBkgs.length > 0 ? "text-stone-800" : "text-stone-400"}
        />
        <Row
          label="Dinner"
          value={`${dinnerBkgs.length} bookings`}
          sub={`${dinnerCovers} covers · 18:00–22:00`}
          valueColor={dinnerBkgs.length > 0 ? "text-stone-800" : "text-stone-400"}
        />
        <Row
          label="Event tonight"
          value={
            todayEvent
              ? todayEvent.name.slice(0, 22) + (todayEvent.name.length > 22 ? "…" : "")
              : "None scheduled"
          }
          sub={
            todayEvent?.start_time
              ? `Starts ${fmtTime(todayEvent.start_time)}`
              : undefined
          }
          valueColor={todayEvent ? "text-stone-800" : "text-stone-400"}
        />
        <Row
          label="Labour cost"
          value={laborPct != null ? `${laborPct.toFixed(1)}%` : "—"}
          sub={laborPct != null ? "of revenue" : "Upload ops report"}
          valueColor={laborColor}
        />
        {walkIn != null && (
          <Row
            label="Walk-in need"
            value={formatCurrency(walkIn)}
            sub="to hit today's target"
            valueColor="text-amber-600"
          />
        )}
        {today.escalationsToday > 0 && (
          <Row
            label="Escalations"
            value={`${today.escalationsToday}`}
            sub="require attention"
            valueColor="text-red-600"
          />
        )}
        {maintenance.outOfService > 0 && (
          <Row
            label="Equipment"
            value={`${maintenance.outOfService} out of SVC`}
            sub={maintenance.urgentIssues[0]?.unit_name}
            valueColor="text-red-600"
          />
        )}
      </div>

      {/* Footer total */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-5 py-3 flex items-center justify-between">
        <span className="text-[11px] text-stone-500 dark:text-stone-500">Total today</span>
        <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
          {today.total} bookings · {today.totalCovers} covers
        </span>
      </div>
    </div>
  );
}
