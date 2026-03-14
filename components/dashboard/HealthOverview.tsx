/**
 * HealthOverview — Zone 2
 *
 * Top row of risk cards:
 * 1. Restaurant Health Score breakdown
 * 2. Compliance Risk
 * 3. Maintenance Risk
 * 4. Revenue Status
 */

import Link from "next/link";
import { cn, formatCurrency } from "@/lib/utils";
import type { RestaurantHealthScore } from "@/lib/commandCenter";
import type {
  ComplianceSummary,
  MaintenanceSummary,
  RevenueForecast,
} from "@/types";

interface Props {
  health:      RestaurantHealthScore;
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
  forecast:    RevenueForecast | null;
}

export default function HealthOverview({ health, compliance, maintenance, forecast }: Props) {
  return (
    <div>
      <SectionLabel>Health &amp; Risk Overview</SectionLabel>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthScoreCard health={health} />
        <ComplianceCard  compliance={compliance} />
        <MaintenanceCard maintenance={maintenance} />
        <RevenueCard     forecast={forecast} />
      </div>
    </div>
  );
}

// ── Health Score Card ──────────────────────────────────────────────────────────

function HealthScoreCard({ health }: { health: RestaurantHealthScore }) {
  const scoreColor =
    health.status === "Strong"           ? "text-emerald-600" :
    health.status === "Stable"           ? "text-blue-600"    :
    health.status === "Attention Needed" ? "text-amber-600"   :
    "text-red-600";

  const breakdown = [
    { label: "Compliance",   value: health.breakdown.compliance,  weight: "30%" },
    { label: "Maintenance",  value: health.breakdown.maintenance, weight: "20%" },
    { label: "Revenue",      value: health.breakdown.revenue,     weight: "20%" },
    { label: "Staffing",     value: health.breakdown.staffing,    weight: "15%" },
    { label: "Data Ready",   value: health.breakdown.dataReady,   weight: "15%" },
  ];

  return (
    <Card>
      <CardTitle icon="🏥">Health Score</CardTitle>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-4xl font-bold tabular-nums", scoreColor)}>
          {health.total}
        </span>
        <span className="text-sm text-stone-400">/ 100</span>
      </div>
      <p className={cn("mt-0.5 text-sm font-semibold", scoreColor)}>{health.status}</p>

      <div className="mt-4 space-y-2">
        {breakdown.map((b) => (
          <div key={b.label}>
            <div className="flex items-center justify-between text-xs text-stone-500 mb-0.5">
              <span>{b.label}</span>
              <span className="font-semibold text-stone-700">{b.value}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  b.value >= 80 ? "bg-emerald-500" :
                  b.value >= 60 ? "bg-amber-400"   :
                  "bg-red-500"
                )}
                style={{ width: `${b.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Compliance Card ─────────────────────────────────────────────────────────────

function ComplianceCard({ compliance }: { compliance: ComplianceSummary }) {
  const isRed    = compliance.expired > 0;
  const isAmber  = !isRed && compliance.due_soon > 0;

  return (
    <Card urgency={isRed ? "red" : isAmber ? "amber" : "none"}>
      <div className="flex items-start justify-between">
        <CardTitle icon="📋">Compliance</CardTitle>
        <Link href="/dashboard/compliance" className="text-xs text-stone-400 hover:text-stone-700 shrink-0">
          Hub →
        </Link>
      </div>

      {/* Score */}
      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn(
          "text-3xl font-bold tabular-nums",
          compliance.compliance_pct >= 80 ? "text-emerald-600" :
          compliance.compliance_pct >= 50 ? "text-amber-600"   :
          "text-red-600"
        )}>
          {compliance.compliance_pct}%
        </span>
        <span className="text-xs text-stone-400">compliant</span>
      </div>

      {/* Status line */}
      {isRed && (
        <p className="mt-2 text-xs font-semibold text-red-700">
          🚨 {compliance.expired} expired — action required
        </p>
      )}
      {isAmber && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          ⚠ {compliance.due_soon} due soon
        </p>
      )}
      {!isRed && !isAmber && compliance.total > 0 && (
        <p className="mt-2 text-xs font-medium text-emerald-600">
          ✓ All certificates up-to-date
        </p>
      )}

      {/* Items list */}
      {compliance.critical_items.length > 0 && (
        <ul className="mt-3 space-y-1">
          {compliance.critical_items.slice(0, 2).map((item) => (
            <li key={item.id} className="text-xs text-red-600 flex items-start gap-1">
              <span className="shrink-0 mt-px">✗</span>
              <span className="truncate">{item.display_name}</span>
            </li>
          ))}
        </ul>
      )}
      {compliance.critical_items.length === 0 && compliance.due_soon_items.length > 0 && (
        <ul className="mt-3 space-y-1">
          {compliance.due_soon_items.slice(0, 2).map((item) => (
            <li key={item.id} className="text-xs text-amber-700 flex items-start gap-1">
              <span className="shrink-0 mt-px">→</span>
              <span className="truncate">{item.display_name}</span>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/dashboard/compliance"
        className={cn(
          "mt-4 block rounded-lg px-3 py-1.5 text-center text-xs font-semibold transition-colors",
          isRed   ? "bg-red-600 text-white hover:bg-red-700"      :
          isAmber ? "bg-amber-500 text-white hover:bg-amber-600"  :
          "bg-stone-100 text-stone-700 hover:bg-stone-200"
        )}
      >
        View Compliance Hub
      </Link>
    </Card>
  );
}

// ── Maintenance Card ────────────────────────────────────────────────────────────

function MaintenanceCard({ maintenance }: { maintenance: MaintenanceSummary }) {
  const isRed   = maintenance.outOfService > 0;
  const isAmber = !isRed && maintenance.openRepairs > 0;
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;

  return (
    <Card urgency={isRed ? "red" : isAmber ? "amber" : "none"}>
      <div className="flex items-start justify-between">
        <CardTitle icon="🔧">Maintenance</CardTitle>
        <Link href="/dashboard/maintenance" className="text-xs text-stone-400 hover:text-stone-700 shrink-0">
          Log →
        </Link>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn(
          "text-3xl font-bold tabular-nums",
          isRed ? "text-red-600" : isAmber ? "text-amber-600" : "text-emerald-600"
        )}>
          {maintenance.totalEquipment}
        </span>
        <span className="text-xs text-stone-400">units</span>
      </div>

      {isRed && (
        <p className="mt-2 text-xs font-semibold text-red-700">
          🔴 {maintenance.outOfService} out of service
        </p>
      )}
      {isAmber && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          🟡 {totalOpen} open issue{totalOpen > 1 ? "s" : ""}
        </p>
      )}
      {!isRed && !isAmber && maintenance.totalEquipment > 0 && (
        <p className="mt-2 text-xs font-medium text-emerald-600">
          ✓ All equipment operational
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStatChip label="Open"      value={maintenance.openRepairs}  color={maintenance.openRepairs > 0  ? "red"   : "stone"} />
        <MiniStatChip label="In Prog."  value={maintenance.inProgress}   color={maintenance.inProgress > 0   ? "amber" : "stone"} />
        <MiniStatChip label="Awaiting"  value={maintenance.awaitingParts} color={maintenance.awaitingParts > 0 ? "amber" : "stone"} />
        <MiniStatChip label="OOS"       value={maintenance.outOfService} color={maintenance.outOfService > 0 ? "red"   : "stone"} />
      </div>

      <Link
        href="/dashboard/maintenance"
        className="mt-4 block rounded-lg bg-stone-100 px-3 py-1.5 text-center text-xs font-semibold text-stone-700 hover:bg-stone-200 transition-colors"
      >
        View Maintenance
      </Link>
    </Card>
  );
}

// ── Revenue Card ────────────────────────────────────────────────────────────────

function RevenueCard({ forecast }: { forecast: RevenueForecast | null }) {
  const hasTarget = !!forecast?.target_sales;
  const gap       = forecast?.sales_gap ?? null;
  const gapPct    = forecast?.sales_gap_pct ?? null;
  const isRed     = hasTarget && gap != null && (gapPct ?? 0) < -15;
  const isAmber   = hasTarget && gap != null && (gapPct ?? 0) < 0 && !isRed;

  return (
    <Card urgency={isRed ? "red" : isAmber ? "amber" : "none"}>
      <div className="flex items-start justify-between">
        <CardTitle icon="📈">Revenue</CardTitle>
        <Link href="/dashboard/settings/targets" className="text-xs text-stone-400 hover:text-stone-700 shrink-0">
          Targets →
        </Link>
      </div>

      {!forecast ? (
        <p className="mt-3 text-xs text-stone-400">No forecast data</p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-stone-900">
              {formatCurrency(forecast.forecast_sales)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-stone-400">forecast sales</p>

          {hasTarget && (
            <p className={cn(
              "mt-2 text-xs font-semibold",
              isRed ? "text-red-700" : isAmber ? "text-amber-700" : "text-emerald-600"
            )}>
              {gap != null && gap >= 0
                ? `✓ ${formatCurrency(gap)} above target`
                : gap != null
                ? `▼ ${formatCurrency(Math.abs(gap))} below target (${Math.abs(gapPct ?? 0).toFixed(1)}%)`
                : "Target set"}
            </p>
          )}

          {!hasTarget && (
            <p className="mt-2 text-xs text-stone-400">No target set for today</p>
          )}

          <div className="mt-3 flex gap-2">
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              forecast.risk_level === "high"   ? "bg-red-100 text-red-700"   :
              forecast.risk_level === "medium" ? "bg-amber-100 text-amber-700" :
              "bg-emerald-100 text-emerald-700"
            )}>
              {forecast.risk_level} risk
            </span>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">
              {forecast.confidence} confidence
            </span>
          </div>
        </>
      )}

      <Link
        href="/dashboard/settings/targets"
        className="mt-4 block rounded-lg bg-stone-100 px-3 py-1.5 text-center text-xs font-semibold text-stone-700 hover:bg-stone-200 transition-colors"
      >
        View Revenue
      </Link>
    </Card>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-stone-400">
      {children}
    </p>
  );
}

function Card({
  children,
  urgency = "none",
}: {
  children: React.ReactNode;
  urgency?: "red" | "amber" | "none";
}) {
  return (
    <div className={cn(
      "flex flex-col rounded-xl border bg-white p-4 shadow-sm",
      urgency === "red"   ? "border-red-200"   :
      urgency === "amber" ? "border-amber-200" :
      "border-stone-200"
    )}>
      {children}
    </div>
  );
}

function CardTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">
      <span>{icon}</span>
      {children}
    </p>
  );
}

function MiniStatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "red" | "amber" | "stone";
}) {
  return (
    <div className={cn(
      "rounded-lg px-2 py-1.5 text-center",
      color === "red"   ? "bg-red-50"   :
      color === "amber" ? "bg-amber-50" :
      "bg-stone-50"
    )}>
      <p className={cn(
        "text-sm font-bold tabular-nums",
        color === "red"   ? "text-red-700"   :
        color === "amber" ? "text-amber-700" :
        "text-stone-500"
      )}>
        {value}
      </p>
      <p className="text-[10px] text-stone-400">{label}</p>
    </div>
  );
}
