/**
 * CommandStatusBar
 *
 * Full-width command status bar.
 * Row 1 — venue identity + service period + date + live alert count
 * Row 2 — 5 status cells: Compliance · Maintenance · Revenue · Staff · Events
 *
 * Each cell shows icon, label, key metric, and a severity chip.
 * Cells with risk are highlighted in red; warnings in amber.
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
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
  id:       string;
  icon:     string;
  label:    string;
  metric:   string;
  chip:     string;
  variant:  StatusVariant;
  href:     string;
  bg?:      string;
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
  const compChip =
    compliance.expired > 0
      ? `${compliance.expired} expired`
      : compliance.due_soon > 0
      ? `${compliance.due_soon} due soon`
      : `${compliance.compliance_pct}% compliant`;
  const compMetric =
    compliance.total > 0
      ? `${compliance.compliance_pct}% compliant`
      : "No records";

  // ── Maintenance ───────────────────────────────────────────────────────────
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;
  const maintVar: StatusVariant =
    maintenance.outOfService > 0 ? "critical" :
    totalOpen > 0               ? "warning"  : "ok";
  const maintChip =
    maintenance.outOfService > 0
      ? `${maintenance.outOfService} out of service`
      : totalOpen > 0
      ? `${totalOpen} open issue${totalOpen > 1 ? "s" : ""}`
      : "All operational";
  const maintMetric =
    maintenance.totalEquipment > 0
      ? `${maintenance.totalEquipment} unit${maintenance.totalEquipment > 1 ? "s" : ""}`
      : "No equipment";

  // ── Revenue ───────────────────────────────────────────────────────────────
  const gapPct  = forecast?.sales_gap_pct ?? null;
  const revVar: StatusVariant =
    !forecast                 ? "neutral" :
    (gapPct ?? 0) < -20       ? "critical" :
    (gapPct ?? 0) < 0         ? "warning"  : "ok";
  const revChip =
    !forecast
      ? "No forecast"
      : gapPct != null && gapPct < 0
      ? `▼ ${Math.abs(gapPct).toFixed(1)}% vs target`
      : gapPct != null && gapPct >= 0
      ? `▲ on target`
      : "Target not set";
  const revMetric = forecast
    ? formatCurrency(forecast.forecast_sales)
    : "No data";

  // ── Staff ─────────────────────────────────────────────────────────────────
  const laborPct = dailyOps.latestReport?.labor_cost_percent ?? null;
  const staffVar: StatusVariant =
    laborPct == null        ? "neutral"  :
    laborPct > 45           ? "critical" :
    laborPct > 35           ? "warning"  : "ok";
  const staffChip =
    laborPct != null ? `${laborPct.toFixed(1)}% labour` : "No data";
  const staffMetric =
    laborPct != null ? `${laborPct.toFixed(1)}% labour cost` : "Upload ops report";

  // ── Events ────────────────────────────────────────────────────────────────
  const todayEvent = events.find((e) => e.event_date === date && !e.cancelled);
  const eventVar: StatusVariant =
    todayEvent ? "info" :
    today.total > 0 ? "neutral" : "muted";
  const eventChip =
    todayEvent   ? todayEvent.name.slice(0, 18) + (todayEvent.name.length > 18 ? "…" : "") :
    today.total > 0 ? `${today.total} bookings` :
    "No events";
  const eventMetric =
    todayEvent
      ? `${today.total} bookings + event`
      : `${today.total} booking${today.total !== 1 ? "s" : ""}`;

  return [
    { id: "compliance",  icon: "📋", label: "Compliance",  metric: compMetric,   chip: compChip,   variant: compVar,  href: "/dashboard/compliance" },
    { id: "maintenance", icon: "🔧", label: "Maintenance", metric: maintMetric,  chip: maintChip,  variant: maintVar, href: "/dashboard/maintenance" },
    { id: "revenue",     icon: "📈", label: "Revenue",     metric: revMetric,    chip: revChip,    variant: revVar,   href: "/dashboard/settings/targets" },
    { id: "staff",       icon: "👥", label: "Staff",       metric: staffMetric,  chip: staffChip,  variant: staffVar, href: "/dashboard/operations" },
    { id: "events",      icon: "🎉", label: "Events",      metric: eventMetric,  chip: eventChip,  variant: eventVar, href: "/dashboard/events" },
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
        "rounded-xl border bg-white overflow-hidden shadow-sm",
        hasRisk ? "border-red-200" : "border-stone-200"
      )}
    >
      {/* ── Row 1: Identity + date + alerts ──────────────────────────── */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-stone-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:flex h-7 w-7 items-center justify-center rounded-lg bg-stone-900 shrink-0">
            <span className="text-xs text-white font-bold">OE</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900 leading-none truncate">
              Ops Engine
            </p>
            <p className="text-[11px] text-stone-400 mt-px leading-none">
              Operations Dashboard
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Service period */}
          <span className="hidden sm:inline-flex rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-700">
            {servicePeriod}
          </span>
          {/* Date */}
          <span className="hidden md:inline text-xs text-stone-500">
            {fmtDate(date)}
          </span>
          {/* Alert count */}
          {activeAlerts > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
                criticalCount > 0
                  ? "bg-red-600 text-white"
                  : "bg-amber-500 text-white"
              )}
            >
              🔔 {activeAlerts}
            </span>
          )}
        </div>
      </div>

      {/* ── Row 2: Status cells ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y divide-stone-100">
        {cells.map((cell) => {
          const isCritical = cell.variant === "critical";
          const isWarning  = cell.variant === "warning";

          return (
            <Link
              key={cell.id}
              href={cell.href}
              className={cn(
                "flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-stone-50 group",
                isCritical && "bg-red-50/50 hover:bg-red-50",
                isWarning  && "bg-amber-50/30 hover:bg-amber-50/60"
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{cell.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400 group-hover:text-stone-600">
                  {cell.label}
                </span>
              </div>
              <p className={cn(
                "text-xs font-semibold leading-snug truncate",
                isCritical ? "text-red-800" :
                isWarning  ? "text-amber-800" :
                "text-stone-700"
              )}>
                {cell.metric}
              </p>
              <StatusChip variant={cell.variant} size="xs" dot>
                {cell.chip}
              </StatusChip>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
