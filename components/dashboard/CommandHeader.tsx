/**
 * CommandHeader — Zone 1
 *
 * Full-width command bar showing: venue name, date, service period,
 * health score ring, quick snapshot stats, and status badges.
 */

import Link from "next/link";
import { cn, formatDisplayDate } from "@/lib/utils";
import type { RestaurantHealthScore } from "@/lib/commandCenter";
import type {
  TodayBookingsSummary,
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
  OperationalAlert,
  VenueEvent,
} from "@/types";

interface Props {
  date:          string;
  servicePeriod: string;
  health:        RestaurantHealthScore;
  today:         TodayBookingsSummary;
  compliance:    ComplianceSummary;
  maintenance:   MaintenanceSummary;
  forecast:      RevenueForecast | null;
  opsAlerts:     OperationalAlert[];
  events:        VenueEvent[];
}

export default function CommandHeader({
  date,
  servicePeriod,
  health,
  today,
  compliance,
  maintenance,
  forecast,
  opsAlerts,
  events,
}: Props) {
  const activeAlerts = opsAlerts.filter((a) => !a.resolved).length;
  const todayEvent   = events.find((e) => e.event_date === date && !e.cancelled);

  const complianceStatus =
    compliance.expired > 0    ? "risk"     :
    compliance.due_soon > 0   ? "warning"  : "good";

  const maintenanceStatus =
    maintenance.outOfService > 0 ? "risk"    :
    maintenance.openRepairs > 0  ? "warning" : "good";

  const revenueStatus =
    !forecast?.target_sales            ? "none"    :
    (forecast.sales_gap_pct ?? 0) < -15 ? "risk"   :
    (forecast.sales_gap_pct ?? 0) < 0  ? "warning" : "good";

  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      {/* Top bar: venue + service period */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 bg-stone-50 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
            Si Cantina Sociale
          </span>
          <span className="h-3 w-px bg-stone-300" />
          <span className="text-xs font-medium text-stone-500">
            {formatDisplayDate(date)}
          </span>
          <span className="rounded-full bg-stone-900 px-2.5 py-0.5 text-[11px] font-semibold text-white">
            {servicePeriod}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeAlerts > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              🔔 {activeAlerts} alert{activeAlerts > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Main header body */}
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        {/* Health score */}
        <div className="flex items-center gap-5">
          <HealthRing score={health.total} status={health.status} />
          <div>
            <p className="text-xl font-bold text-stone-900">Operations</p>
            <p className={cn(
              "mt-0.5 text-sm font-semibold",
              health.status === "Strong"           ? "text-emerald-600" :
              health.status === "Stable"           ? "text-blue-600"    :
              health.status === "Attention Needed" ? "text-amber-600"   :
              "text-red-600"
            )}>
              {health.status}
            </p>
          </div>
        </div>

        {/* Today snapshot */}
        <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-4">
          <SnapStat label="Bookings" value={String(today.total)} sub={`${today.totalCovers} covers`} />
          {todayEvent && (
            <SnapStat label="Tonight" value={todayEvent.name} sub={todayEvent.start_time ?? "Event"} highlight="violet" />
          )}
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          <StatusBadge label="Compliance"  status={complianceStatus} />
          <StatusBadge label="Maintenance" status={maintenanceStatus} />
          <StatusBadge label="Revenue"     status={revenueStatus} />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function HealthRing({ score, status }: { score: number; status: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color =
    status === "Strong"           ? "#10b981" :
    status === "Stable"           ? "#3b82f6" :
    status === "Attention Needed" ? "#f59e0b" :
    "#ef4444";

  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg className="absolute inset-0 -rotate-90" width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e7e5e4" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="relative text-sm font-bold text-stone-900">{score}</span>
    </div>
  );
}

function SnapStat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: "violet";
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-right min-w-[80px]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <p className={cn(
        "mt-0.5 truncate text-sm font-bold",
        highlight === "violet" ? "text-violet-700" : "text-stone-900"
      )}>{value}</p>
      <p className="truncate text-[10px] text-stone-400">{sub}</p>
    </div>
  );
}

function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: "good" | "warning" | "risk" | "none";
}) {
  const config = {
    good:    { bg: "bg-emerald-50 border-emerald-200 text-emerald-700", dot: "bg-emerald-500", sub: "Good" },
    warning: { bg: "bg-amber-50 border-amber-200 text-amber-700",       dot: "bg-amber-400",   sub: "Warning" },
    risk:    { bg: "bg-red-50 border-red-200 text-red-700",             dot: "bg-red-500",     sub: "At Risk" },
    none:    { bg: "bg-stone-100 border-stone-200 text-stone-400",      dot: "bg-stone-300",   sub: "No Data" },
  }[status];

  return (
    <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", config.bg)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", config.dot)} />
      <span>{label}</span>
      <span className="font-normal opacity-75">— {config.sub}</span>
    </div>
  );
}
