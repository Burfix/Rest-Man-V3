/**
 * StoreRiskGrid
 *
 * Responsive grid of per-store summary cards — the "risk map".
 * Each card shows the store's risk colour, operating score, revenue position,
 * labour %, and action completion — giving executives a full picture at a glance.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { StoreSummary, RiskLevel } from "@/services/ops/headOffice";
import type { ScoreGrade } from "@/services/ops/operatingScore";

// ── Palettes ───────────────────────────────────────────────────────────────────

const RISK_STYLE: Record<RiskLevel, {
  border:  string;
  header:  string;
  badge:   string;
  dot:     string;
  label:   string;
}> = {
  green:  {
    border: "border-emerald-200 dark:border-emerald-800",
    header: "bg-emerald-50 dark:bg-emerald-950/20",
    badge:  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    dot:    "bg-emerald-500",
    label:  "On Track",
  },
  yellow: {
    border: "border-amber-200 dark:border-amber-800",
    header: "bg-amber-50 dark:bg-amber-950/20",
    badge:  "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    dot:    "bg-amber-500",
    label:  "Attention",
  },
  red: {
    border: "border-red-300 dark:border-red-700 ring-1 ring-red-300 dark:ring-red-700",
    header: "bg-red-100 dark:bg-red-950/40",
    badge:  "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    dot:    "bg-red-500 animate-ping",
    label:  "At Risk",
  },
};

const GRADE_TEXT: Record<ScoreGrade, string> = {
  A: "text-emerald-600 dark:text-emerald-400",
  B: "text-lime-600 dark:text-lime-400",
  C: "text-amber-600 dark:text-amber-400",
  D: "text-orange-600 dark:text-orange-400",
  F: "text-red-600 dark:text-red-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtZAR(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000)     return `R${Math.round(n / 1_000)}k`;
  return `R${Math.round(n)}`;
}

function RevenueBar({ actual, target }: { actual: number | null; target: number | null }) {
  if (actual === null || target === null || target === 0) {
    return <div className="h-1 w-full rounded-full bg-stone-100 dark:bg-stone-800" />;
  }
  const pct = Math.min(100, Math.round((actual / target) * 100));
  const on  = actual >= target;
  return (
    <div className="h-1 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
      <div
        className={cn("h-1 rounded-full transition-all", on ? "bg-emerald-500" : "bg-amber-400")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function CompletionBar({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <div className="h-1 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
      <div
        className={cn("h-1 rounded-full", pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-500")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Store card ─────────────────────────────────────────────────────────────────

function StoreCard({ store }: { store: StoreSummary }) {
  const risk  = RISK_STYLE[store.risk_level];
  const grade = store.score_grade as ScoreGrade | null;
  const pendingActions = store.actions_total - store.actions_completed;

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden flex flex-col group transition-all hover:shadow-md hover:scale-[1.01]",
      risk.border
    )}>

      {/* Header */}
      <div className={cn("flex items-center justify-between gap-2 px-4 py-3", risk.header)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative shrink-0">
            <span className={cn("h-2 w-2 rounded-full block", risk.dot)} />
            {store.risk_level === "red" && (
              <span className="absolute inset-0 h-2 w-2 rounded-full bg-red-500 opacity-75" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate leading-tight">
              {store.name}
            </p>
            <p className="text-[10px] text-stone-400 dark:text-stone-500">{store.city}</p>
          </div>
        </div>

        {/* Risk badge */}
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", risk.badge)}>
          {risk.label}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3 flex-1 bg-white dark:bg-stone-900">

        {/* Score row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Score</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-stone-900 dark:text-stone-100 leading-none">
                {store.operating_score ?? "—"}
              </span>
              {grade && (
                <span className={cn("text-sm font-black", GRADE_TEXT[grade])}>
                  {grade}
                </span>
              )}
            </div>
          </div>

          {/* Compliance + Maintenance mini indicators */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-400">Compliance</span>
              <span className={cn("h-2.5 w-2.5 rounded-full", {
                "bg-emerald-500": (store.compliance_score ?? 20) === 20,
                "bg-amber-400":   (store.compliance_score ?? 20) === 10,
                "bg-red-500":     (store.compliance_score ?? 20) === 0,
              })} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-400">Maintenance</span>
              <span className={cn("h-2.5 w-2.5 rounded-full", {
                "bg-emerald-500": (store.maintenance_score ?? 10) === 20,
                "bg-amber-400":   (store.maintenance_score ?? 10) === 10,
                "bg-red-500":     (store.maintenance_score ?? 10) === 0,
              })} />
            </div>
          </div>
        </div>

        {/* Revenue */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Revenue</span>
            <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-400 tabular-nums">
              {fmtZAR(store.sales_net_vat)}{store.revenue_target ? ` / ${fmtZAR(store.revenue_target)}` : ""}
            </span>
          </div>
          <RevenueBar actual={store.sales_net_vat} target={store.revenue_target} />
          {store.revenue_gap_pct !== null && (
            <p className={cn("text-[10px] mt-0.5", store.revenue_gap_pct > 10 ? "text-red-500" : store.revenue_gap_pct > 0 ? "text-amber-500" : "text-emerald-500")}>
              {store.revenue_gap_pct > 0 ? `${store.revenue_gap_pct.toFixed(1)}% below target` : `${Math.abs(store.revenue_gap_pct).toFixed(1)}% above target`}
            </p>
          )}
        </div>

        {/* Labour */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Labour</span>
          <span className={cn("text-[11px] font-bold tabular-nums", {
            "text-emerald-600 dark:text-emerald-400": (store.labour_pct ?? 40) <= 30,
            "text-amber-600 dark:text-amber-400":     (store.labour_pct ?? 40) <= 35,
            "text-red-600 dark:text-red-400":         (store.labour_pct ?? 40) > 35,
          })}>
            {store.labour_pct !== null ? `${store.labour_pct.toFixed(1)}%` : "—"}
          </span>
        </div>

        {/* Actions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Actions</span>
            <span className="text-[11px] text-stone-500 tabular-nums">
              {store.actions_completed}/{store.actions_total}
              {store.actions_overdue > 0 && (
                <span className="ml-1.5 text-red-500 font-bold">·{store.actions_overdue} overdue</span>
              )}
            </span>
          </div>
          <CompletionBar pct={store.actions_completion_pct} />
          {pendingActions > 0 && (
            <p className={cn(
              "text-[10px] mt-1 font-semibold",
              store.actions_overdue > 0 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
            )}>
              {pendingActions} pending{store.actions_overdue > 0 ? ` · ${store.actions_overdue} late` : ""}
            </p>
          )}
        </div>

        {/* Snapshot date */}
        {store.snapshot_date && (
          <p className="text-[10px] text-stone-300 dark:text-stone-700">
            Data: {store.snapshot_date}
          </p>
        )}
      </div>

      {/* Footer CTA */}
      <div className="border-t border-stone-100 dark:border-stone-800 px-4 py-2 bg-white dark:bg-stone-900">
        <Link
          href={`/dashboard?site=${store.site_id}`}
          className={cn(
            "block text-center text-[11px] font-bold uppercase tracking-wider py-0.5 transition-colors rounded",
            store.risk_level === "red"
              ? "text-red-600 dark:text-red-400 hover:text-red-900"
              : "text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          )}
        >
          {store.risk_level === "red" ? "🚨 Needs attention →" : "Open dashboard →"}
        </Link>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  stores: StoreSummary[];
}

export default function StoreRiskGrid({ stores }: Props) {
  if (stores.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-8 text-center">
        <p className="text-sm text-stone-400">No active stores found.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 dark:text-stone-400">
          Store Risk Map
        </h2>
        <span className="text-[11px] text-stone-400">{stores.length} stores</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stores.map((store) => (
          <StoreCard key={store.site_id} store={store} />
        ))}
      </div>
    </section>
  );
}
