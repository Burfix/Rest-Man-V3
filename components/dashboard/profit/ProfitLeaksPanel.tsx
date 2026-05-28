/**
 * components/dashboard/profit/ProfitLeaksPanel.tsx
 *
 * Active Alerts — urgency-first profit leak display for store managers.
 *
 * Critical leaks get red alert treatment. Each card leads with
 * financial impact and "What to do now" as the primary call to action.
 * Empty state is a satisfying green "All Clear."
 */

"use client";

import { cn } from "@/lib/utils";
import type { ProfitLeak, LeakSeverity } from "@/lib/profit/types";

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtCurrency(n: number, symbol = "R"): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000)     return `${symbol}${Math.round(n / 1_000)}k`;
  return `${symbol}${Math.round(n).toLocaleString()}`;
}

// ── Severity config ───────────────────────────────────────────────────────────

const SEV: Record<LeakSeverity, {
  label: string;
  icon: string;
  cardBg: string;
  cardBorder: string;
  badgeBg: string;
  impactColor: string;
  actionBg: string;
}> = {
  critical: {
    label:       "CRITICAL",
    icon:        "⚠",
    cardBg:      "bg-red-50 dark:bg-red-900/15",
    cardBorder:  "border-red-300 dark:border-red-800/50",
    badgeBg:     "bg-red-600 text-white",
    impactColor: "text-red-600 dark:text-red-400",
    actionBg:    "bg-white/80 dark:bg-stone-900/60 border-red-100 dark:border-red-900/30",
  },
  high: {
    label:       "HIGH",
    icon:        "↑",
    cardBg:      "bg-orange-50 dark:bg-orange-900/10",
    cardBorder:  "border-orange-300 dark:border-orange-800/40",
    badgeBg:     "bg-orange-500 text-white",
    impactColor: "text-orange-600 dark:text-orange-400",
    actionBg:    "bg-white/80 dark:bg-stone-900/60 border-orange-100 dark:border-orange-900/30",
  },
  medium: {
    label:       "MEDIUM",
    icon:        "~",
    cardBg:      "bg-amber-50 dark:bg-amber-900/10",
    cardBorder:  "border-amber-200 dark:border-amber-800/30",
    badgeBg:     "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    impactColor: "text-amber-700 dark:text-amber-400",
    actionBg:    "bg-white/80 dark:bg-stone-900/60 border-stone-200 dark:border-stone-700",
  },
  low: {
    label:       "LOW",
    icon:        "·",
    cardBg:      "bg-white dark:bg-stone-900",
    cardBorder:  "border-stone-200 dark:border-stone-700",
    badgeBg:     "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
    impactColor: "text-stone-500",
    actionBg:    "bg-stone-50 dark:bg-stone-800/50 border-stone-200 dark:border-stone-700",
  },
};

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ leak, symbol }: { leak: ProfitLeak; symbol: string }) {
  const cfg = SEV[leak.severity];

  return (
    <div className={cn("rounded-xl border p-4", cfg.cardBg, cfg.cardBorder)}>
      {/* Header: severity badge + title + financial impact */}
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={cn(
              "rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest",
              cfg.badgeBg,
            )}>
              {cfg.icon} {cfg.label}
            </span>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-stone-400">
              {leak.category.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-[13px] font-bold text-stone-900 dark:text-stone-100 leading-snug">
            {leak.title}
          </p>
        </div>

        {/* Financial impact — right-aligned, big */}
        {leak.financialImpact != null && (
          <div className="shrink-0 text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 mb-0.5">
              Impact
            </p>
            <p className={cn("text-[18px] font-extrabold tabular-nums leading-tight", cfg.impactColor)}>
              -{fmtCurrency(leak.financialImpact, symbol)}
            </p>
          </div>
        )}
      </div>

      {/* Explanation */}
      <p className="text-[12px] text-stone-600 dark:text-stone-400 leading-relaxed mb-3">
        {leak.explanation}
      </p>

      {/* "What to do now" action callout */}
      <div className={cn("rounded-lg border px-3 py-2.5", cfg.actionBg)}>
        <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-1">
          What to do now
        </p>
        <p className="text-[12px] font-semibold text-stone-800 dark:text-stone-200 leading-relaxed">
          {leak.recommendedAction}
        </p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProfitLeaksPanel({
  leaks,
  symbol,
}: {
  leaks: ProfitLeak[];
  symbol: string;
}) {
  // Sort: critical → high → medium → low, data gaps last
  const ORDER: Record<LeakSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const actionable = leaks
    .filter((l) => l.category !== "data")
    .sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));
  const dataGaps = leaks.filter((l) => l.category === "data");

  const hasCritical   = actionable.some((l) => l.severity === "critical");
  const totalImpact   = actionable.reduce((s, l) => s + (l.financialImpact ?? 0), 0);

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Panel header */}
      <div className={cn(
        "px-5 py-4 border-b",
        hasCritical
          ? "bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30"
          : "bg-white dark:bg-stone-900 border-stone-100 dark:border-stone-800",
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className={cn(
              "text-sm font-bold",
              hasCritical
                ? "text-red-700 dark:text-red-400"
                : "text-stone-900 dark:text-stone-100",
            )}>
              {hasCritical ? "⚠ Active Alerts" : "Active Alerts"}
            </h2>
            {actionable.length > 0 && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                hasCritical
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
              )}>
                {actionable.length}
              </span>
            )}
          </div>

          {/* Total impact summary */}
          {totalImpact > 0 && (
            <div className="text-right shrink-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400">
                Total at risk
              </p>
              <p className="text-sm font-extrabold tabular-nums text-red-600 dark:text-red-400">
                -{fmtCurrency(totalImpact, symbol)}
              </p>
            </div>
          )}
        </div>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Margin leaks active right now
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* All-clear empty state */}
        {actionable.length === 0 && dataGaps.length === 0 && (
          <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/30 px-5 py-7 text-center">
            <p className="text-2xl mb-2">✓</p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
              All Clear
            </p>
            <p className="text-[11px] text-stone-500 mt-0.5">
              No margin leaks detected in this period
            </p>
          </div>
        )}

        {/* Actionable alerts — sorted critical first */}
        {actionable.map((leak) => (
          <AlertCard key={leak.id} leak={leak} symbol={symbol} />
        ))}

        {/* Data gaps — secondary, collapsible feel */}
        {dataGaps.length > 0 && (
          <div className={cn(
            "border-t border-stone-100 dark:border-stone-800 pt-3",
            actionable.length > 0 && "mt-1",
          )}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-2">
              Data Gaps
            </p>
            <div className="flex flex-col gap-2">
              {dataGaps.map((leak) => (
                <div
                  key={leak.id}
                  className="rounded-lg bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-3 py-2"
                >
                  <p className="text-[12px] text-stone-500 dark:text-stone-400 leading-relaxed">
                    {leak.explanation}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
