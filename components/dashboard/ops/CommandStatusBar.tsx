/**
 * CommandStatusBar
 *
 * Full-width command status bar — OS-style horizontal header.
 * Row 1 — venue identity + service period + date + live alert count
 * Row 2 — 5 compact status columns: Compliance · Maintenance · Revenue · Staff · Events
 *
 * Each column shows a primary metric (large) + one supporting status line.
 * No colored cell backgrounds — status conveyed purely through typography and dots.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import type { StatusVariant } from "@/components/ui/StatusChip";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  DailyOperationsDashboardSummary,
  VenueEvent,
  TodayBookingsSummary,
  OperationalAlert,
} from "@/types";

interface Props {
  date:          string; // YYYY-MM-DD
  servicePeriod: string;
  compliance:    ComplianceSummary;
  maintenance:   MaintenanceSummary;
  forecast:      RevenueForecast | null;
  dailyOps:      DailyOperationsDashboardSummary;
  events:        VenueEvent[];
  today:         TodayBookingsSummary;
  opsAlerts:     OperationalAlert[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("en-ZA", {
      weekday: "short",
      day:     "numeric",
      month:   "long",
      year:    "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Status cell configs ───────────────────────────────────────────────────────

interface StatusCell {
  id:      string;
  label:   string;
  metric:  string;   // primary value shown large
  support: string;   // one-line support / status text
  variant: StatusVariant;
  href:    string;
}

function buildCells(
  compliance:  ComplianceSummary,
  maintenance: MaintenanceSummary,
  forecast:    RevenueForecast | null,
  dailyOps:    DailyOperationsDashboardSummary,
  events:      VenueEvent[],
  today:       TodayBookingsSummary,
  date:        string
): StatusCell[] {
  // ── Compliance ────────────────────────────────────────────────────────────
  const compVar: StatusVariant =
    compliance.expired > 0   ? "critical" :
    compliance.due_soon > 0  ? "warning"  : "ok";
  const compMetric =
    compliance.total > 0 ? `${compliance.compliance_pct}%` : "—";
  const compSupport =
    compliance.expired > 0  ? `${compliance.expired} certificate${compliance.expired > 1 ? "s" : ""} expired` :
    compliance.due_soon > 0 ? `${compliance.due_soon} due within 30d` :
    compliance.total > 0    ? "All current" :
    "No records";

  // ── Maintenance ───────────────────────────────────────────────────────────
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;
  const maintVar: StatusVariant =
    maintenance.outOfService > 0 ? "critical" :
    totalOpen > 0               ? "warning"  : "ok";
  const maintMetric =
    maintenance.totalEquipment > 0 ? `${totalOpen} open` : "—";
  const maintSupport =
    maintenance.outOfService > 0
      ? `${maintenance.outOfService} out of service`
      : totalOpen > 0
      ? `${maintenance.totalEquipment} units tracked`
      : maintenance.totalEquipment > 0
      ? "All operational"
      : "No equipment";

  // ── Revenue ───────────────────────────────────────────────────────────────
  const gapPct = forecast?.sales_gap_pct ?? null;
  const revVar: StatusVariant =
    !forecast           ? "neutral" :
    (gapPct ?? 0) < -20 ? "critical" :
    (gapPct ?? 0) < 0   ? "warning"  : "ok";
  const revMetric = forecast ? formatCurrency(forecast.forecast_sales) : "—";
  const revSupport =
    !forecast                ? "No forecast set" :
    gapPct != null && gapPct < 0
      ? `▼ ${Math.abs(gapPct).toFixed(1)}% below target` :
    gapPct != null
      ? "On track" :
    "Target not set";

  // ── Staff ─────────────────────────────────────────────────────────────────
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;
  const staffVar: StatusVariant =
    laborPct == null  ? "neutral"  :
    laborPct > 45     ? "critical" :
    laborPct > 35     ? "warning"  : "ok";
  const staffMetric =
    laborPct != null ? `${laborPct.toFixed(1)}%` : `${today.total} bkgs`;
  const staffSupport =
    laborPct != null
      ? "labour cost"
      : today.total > 0
      ? `${today.totalCovers} covers today`
      : "Upload ops report";

  // ── Events ────────────────────────────────────────────────────────────────
  const todayEvent = events.find((e) => e.event_date === date && !e.cancelled);
  const eventVar: StatusVariant =
    todayEvent      ? "info" :
    today.total > 0 ? "neutral" : "muted";
  const eventMetric =
    todayEvent
      ? todayEvent.name.slice(0, 16) + (todayEvent.name.length > 16 ? "…" : "")
      : `${today.total} bookings`;
  const eventSupport =
    todayEvent
      ? `${today.total} booking${today.total !== 1 ? "s" : ""} today`
      : today.total > 0
      ? `${today.totalCovers} covers`
      : "No events today";

  return [
    { id: "compliance",  label: "Compliance",  metric: compMetric,  support: compSupport,  variant: compVar,  href: "/dashboard/compliance" },
    { id: "maintenance", label: "Maintenance", metric: maintMetric, support: maintSupport, variant: maintVar, href: "/dashboard/maintenance" },
    { id: "revenue",     label: "Revenue",     metric: revMetric,   support: revSupport,   variant: revVar,   href: "/dashboard/settings/targets" },
    { id: "staff",       label: "Staff",       metric: staffMetric, support: staffSupport, variant: staffVar, href: "/dashboard/operations" },
    { id: "events",      label: "Events",      metric: eventMetric, support: eventSupport, variant: eventVar, href: "/dashboard/events" },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CommandStatusBar({
  date,
  servicePeriod,
  compliance,
  maintenance,
  forecast,
  dailyOps,
  events,
  today,
  opsAlerts,
}: Props) {
  const activeAlerts = opsAlerts.filter((a) => !a.resolved).length;
  const criticalCount = opsAlerts.filter(
    (a) => !a.resolved && (a.severity === "critical" || a.severity === "high")
  ).length;

  const cells = buildCells(compliance, maintenance, forecast, dailyOps, events, today, date);
  const hasRisk = cells.some((c) => c.variant === "critical");

  return (
    <div
      className={cn(
        "rounded-xl border bg-white overflow-hidden",
        hasRisk ? "border-red-200" : "border-stone-200"
      )}
    >
      {/* ── Row 1: Identity + period + date + alerts ──────────────────── */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-stone-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex h-6 w-6 items-center justify-center rounded-md bg-stone-900 shrink-0">
            <span className="text-[10px] text-white font-bold tracking-tight">OE</span>
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <p className="text-sm font-semibold text-stone-900 leading-none truncate">
              Ops Engine
            </p>
            <span className="text-stone-300 text-xs hidden sm:inline">·</span>
            <p className="hidden sm:block text-xs text-stone-500 leading-none truncate">
              Operations Command
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Service period */}
          <span className="hidden sm:inline-flex items-center rounded-full border border-stone-200 px-2.5 py-0.5 text-[11px] font-medium text-stone-600 bg-stone-50">
            {servicePeriod}
          </span>
          {/* Separator */}
          <span className="hidden md:inline text-stone-300 text-xs">·</span>
          {/* Date */}
          <span className="hidden md:inline text-[11px] text-stone-500">
            {fmtDate(date)}
          </span>
          {/* Alert pill */}
          {activeAlerts > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                criticalCount > 0
                  ? "bg-red-600 text-white"
                  : "bg-amber-500 text-white"
              )}
            >
              ● {activeAlerts} alert{activeAlerts > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* ── Row 2: 5 status columns ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y divide-stone-100">
        {cells.map((cell) => {
          const isCritical = cell.variant === "critical";
          const isWarning  = cell.variant === "warning";
          const isOk       = cell.variant === "ok";

          const metricColor =
            isCritical ? "text-red-700" :
            isWarning  ? "text-amber-700" :
            isOk       ? "text-emerald-700" :
            "text-stone-800";

          const supportColor =
            isCritical ? "text-red-500" :
            isWarning  ? "text-amber-600" :
            isOk       ? "text-emerald-600" :
            "text-stone-400";

          const dot =
            isCritical ? "bg-red-500" :
            isWarning  ? "bg-amber-400" :
            isOk       ? "bg-emerald-400" :
            "bg-stone-300";

          return (
            <Link
              key={cell.id}
              href={cell.href}
              className="flex flex-col gap-1 px-4 py-3.5 hover:bg-stone-50 transition-colors group"
            >
              <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 group-hover:text-stone-500">
                {cell.label}
              </span>
              <p className={cn("text-sm font-bold leading-tight tabular-nums truncate", metricColor)}>
                {cell.metric}
              </p>
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                <span className={cn("text-[11px] leading-none truncate", supportColor)}>
                  {cell.support}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
