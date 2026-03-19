/**
 * GroupScoreHeader
 *
 * Full-width banner at the top of the Head Office dashboard.
 * Shows group average operating score, risk traffic light and
 * five KPI tiles: Revenue, Labour, Compliance, Maintenance, Actions.
 */

import { cn } from "@/lib/utils";
import type { GroupMetrics } from "@/services/ops/headOffice";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Grade palette ─────────────────────────────────────────────────────────────

const GRADE_PALETTE: Record<ScoreGrade, { ring: string; number: string; badge: string; label: string }> = {
  A: { ring: "ring-emerald-400", number: "text-emerald-600 dark:text-emerald-400", badge: "bg-emerald-600 text-white", label: "Excellent" },
  B: { ring: "ring-lime-400",    number: "text-lime-600 dark:text-lime-400",       badge: "bg-lime-600 text-white",    label: "Good"      },
  C: { ring: "ring-amber-400",   number: "text-amber-600 dark:text-amber-400",     badge: "bg-amber-500 text-white",   label: "Needs Attention" },
  D: { ring: "ring-orange-400",  number: "text-orange-600 dark:text-orange-400",   badge: "bg-orange-600 text-white",  label: "At Risk"   },
  F: { ring: "ring-red-500 animate-pulse", number: "text-red-600 dark:text-red-400", badge: "bg-red-600 text-white", label: "Critical" },
};

function scoreToGrade(score: number | null): ScoreGrade {
  if (score === null) return "F";
  if (score >= 85)    return "A";
  if (score >= 70)    return "B";
  if (score >= 55)    return "C";
  if (score >= 40)    return "D";
  return "F";
}

function fmtZAR(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000)     return `R${Math.round(n / 1_000)}k`;
  return `R${Math.round(n)}`;
}

// ── Subcomponent: KPI tile ─────────────────────────────────────────────────────

function KpiTile({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon:   string;
  label:  string;
  value:  string;
  sub?:   string;
  alert?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-xl border px-4 py-3 flex flex-col gap-0.5",
      alert
        ? "border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-950/20"
        : "border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
    )}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500 flex items-center gap-1">
        <span>{icon}</span> {label}
      </p>
      <p className={cn(
        "text-lg font-extrabold leading-none tabular-nums",
        alert ? "text-red-600 dark:text-red-400" : "text-stone-900 dark:text-stone-100"
      )}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-stone-400 dark:text-stone-500 leading-none">{sub}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  metrics:    GroupMetrics;
  storeCount: number;
}

export default function GroupScoreHeader({ metrics, storeCount }: Props) {
  const score     = metrics.avg_operating_score;
  const grade     = scoreToGrade(score);
  const palette   = GRADE_PALETTE[grade];

  const revGap = metrics.total_revenue !== null && metrics.total_revenue_target !== null && metrics.total_revenue_target > 0
    ? ((metrics.total_revenue_target - metrics.total_revenue) / metrics.total_revenue_target * 100)
    : null;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Top banner ─── critical alert strip */}
      {metrics.red_stores > 0 && (
        <div className="flex items-center gap-3 bg-red-600 px-5 py-2">
          <span className="h-2 w-2 rounded-full bg-white animate-ping shrink-0" />
          <p className="text-xs font-bold text-white uppercase tracking-wider">
            {metrics.red_stores} store{metrics.red_stores > 1 ? "s" : ""} require immediate attention
          </p>
        </div>
      )}

      <div className="px-5 py-4 grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">

        {/* ── Left: group score ── */}
        <div className="flex items-center gap-5 border-b border-stone-100 dark:border-stone-800 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">

          {/* Score ring */}
          <div className={cn(
            "relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full ring-4",
            palette.ring
          )}>
            <span className={cn("text-3xl font-black tabular-nums leading-none", palette.number)}>
              {score ?? "—"}
            </span>
            {/* Grade badge */}
            <span className={cn(
              "absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black",
              palette.badge
            )}>
              {grade}
            </span>
          </div>

          {/* Label + store count */}
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-500">
              Group Score
            </p>
            <p className={cn("text-base font-bold leading-tight", palette.number)}>
              {palette.label}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {storeCount} store{storeCount !== 1 ? "s" : ""} active
            </p>

            {/* Risk traffic lights */}
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                metrics.red_stores > 0 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : "bg-stone-100 dark:bg-stone-800 text-stone-400"
              )}>
                🔴 {metrics.red_stores}
              </span>
              <span className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                metrics.yellow_stores > 0 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-stone-100 dark:bg-stone-800 text-stone-400"
              )}>
                🟡 {metrics.yellow_stores}
              </span>
              <span className={cn(
                "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                metrics.green_stores > 0 ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300" : "bg-stone-100 dark:bg-stone-800 text-stone-400"
              )}>
                🟢 {metrics.green_stores}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right: KPI grid ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:pl-2">
          <KpiTile
            icon="💰"
            label="Group Revenue"
            value={fmtZAR(metrics.total_revenue)}
            sub={metrics.total_revenue_target ? `Target ${fmtZAR(metrics.total_revenue_target)}${revGap !== null && revGap > 0 ? ` (${revGap.toFixed(1)}% gap)` : " ✓"}` : undefined}
            alert={revGap !== null && revGap > 10}
          />
          <KpiTile
            icon="👥"
            label="Avg Labour"
            value={metrics.avg_labour_pct !== null ? `${metrics.avg_labour_pct}%` : "—"}
            sub={
              metrics.avg_labour_pct !== null
                ? metrics.avg_labour_pct <= 30 ? "Healthy"
                  : metrics.avg_labour_pct <= 35 ? "Elevated"
                  : "Over budget"
                : undefined
            }
            alert={(metrics.avg_labour_pct ?? 0) > 35}
          />
          <KpiTile
            icon="📋"
            label="Compliance Risk"
            value={String(metrics.compliance_risk_count)}
            sub={metrics.compliance_risk_count === 0 ? "All stores clear" : `store${metrics.compliance_risk_count > 1 ? "s" : ""} with issues`}
            alert={metrics.compliance_risk_count > 0}
          />
          <KpiTile
            icon="🔧"
            label="Maintenance Risk"
            value={String(metrics.maintenance_risk_count)}
            sub={metrics.maintenance_risk_count === 0 ? "All stores clear" : `store${metrics.maintenance_risk_count > 1 ? "s" : ""} with issues`}
            alert={metrics.maintenance_risk_count > 0}
          />
          <KpiTile
            icon="✅"
            label="Action Completion"
            value={metrics.group_completion_pct !== null ? `${metrics.group_completion_pct}%` : "—"}
            sub={metrics.total_actions_overdue > 0 ? `${metrics.total_actions_overdue} overdue` : `${metrics.total_actions_completed} completed`}
            alert={metrics.total_actions_overdue > 0}
          />
        </div>
      </div>
    </div>
  );
}
