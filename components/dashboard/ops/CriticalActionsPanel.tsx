/**
 * CriticalActionsPanel — Operations Control UI
 *
 * Every row surfaces:
 *   - Severity + impact tag (BLOCKER / HIGH RISK / etc.)
 *   - Problem statement (what's wrong)
 *   - Specific action (what to do)
 *   - Recovery metric (what outcome is needed)
 *   - Service-window countdown (how much time is left)
 *   - Three action buttons: Execute · Assign · Done
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import ImpactTag from "@/components/ui/ImpactTag";
import type { DashboardAction, ActionSeverity, ActionCategory } from "@/lib/commandCenter";

interface Props {
  actions: DashboardAction[];
}

const SEVERITY: Record<ActionSeverity, {
  accent:  string;
  badge:   string;
  label:   string;
  pulse:   boolean;
}> = {
  critical: {
    accent: "border-l-red-600",
    badge:  "bg-red-600 text-white",
    label:  "Critical",
    pulse:  true,
  },
  urgent: {
    accent: "border-l-amber-500",
    badge:  "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700",
    label:  "Urgent",
    pulse:  true,
  },
  action: {
    accent: "border-l-sky-400 dark:border-l-sky-600",
    badge:  "bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-800",
    label:  "Action",
    pulse:  false,
  },
  watch: {
    accent: "border-l-stone-300 dark:border-l-stone-600",
    badge:  "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 ring-1 ring-stone-200 dark:ring-stone-700",
    label:  "Watch",
    pulse:  false,
  },
};

const CATEGORY_ICON: Record<ActionCategory, string> = {
  compliance:  "📋",
  maintenance: "🔧",
  revenue:     "📈",
  staffing:    "👥",
  events:      "🎭",
  data:        "📊",
};

// ── Countdown formatter ───────────────────────────────────────────────────────

function fmtCountdown(mins: number): string {
  if (mins <= 0)   return "Service closed";
  if (mins < 60)   return `${mins}m left in service`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m left in service` : `${h}h left in service`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CriticalActionsPanel({ actions }: Props) {
  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-4">
        <span className="text-xl shrink-0" aria-hidden>✅</span>
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            No action required right now
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-600 mt-0.5">
            All operational areas are in order. Stay sharp — issues can emerge at any time.
          </p>
        </div>
      </div>
    );
  }

  const criticalCount  = actions.filter((a) => a.severity === "critical").length;
  const urgentCount    = actions.filter((a) => a.severity === "urgent").length;
  const highRiskActions = actions.filter((a) => a.isHighRisk);

  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* ── HIGH RISK banner ── shown when any action is flagged as high risk */}
      {highRiskActions.length > 0 && (
        <div className="flex items-center gap-3 border-b border-red-200 dark:border-red-900 bg-red-600 px-5 py-2.5">
          <span className="h-2 w-2 rounded-full bg-white animate-ping shrink-0" />
          <p className="text-xs font-bold text-white uppercase tracking-widest">
            HIGH RISK — Immediate action required
          </p>
          <span className="ml-auto text-[10px] font-semibold text-red-100">
            {highRiskActions.length} high-risk item{highRiskActions.length > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
            Priority Actions
          </h2>
          <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-px text-[10px] font-bold text-stone-600 dark:text-stone-400 tabular-nums">
            {actions.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-px text-[10px] font-bold text-white">
              <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
              {criticalCount} critical
            </span>
          )}
          {urgentCount > 0 && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-px text-[10px] font-bold text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700">
              {urgentCount} urgent
            </span>
          )}
        </div>
      </div>

      {/* Action rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {actions.slice(0, 7).map((action, idx) => {
          const cfg  = SEVERITY[action.severity];
          const icon = CATEGORY_ICON[action.category] ?? "⚠️";
          return (
            <div
              key={idx}
              className={cn(
                "border-l-[3px] px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors",
                cfg.accent,
                action.isHighRisk && "bg-red-50/40 dark:bg-red-950/10"
              )}
            >
              {/* Row 1 — impact tag + severity badge + title */}
              <div className="flex items-start gap-2.5 mb-2">
                <span className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider leading-none whitespace-nowrap",
                  cfg.badge
                )}>
                  {action.isHighRisk ? "HIGH RISK" : cfg.label}
                  {cfg.pulse && (
                    <span className="ml-1 inline-block h-1 w-1 rounded-full bg-current align-middle opacity-80 animate-pulse" />
                  )}
                </span>

                <span className="text-sm shrink-0 mt-px leading-none select-none" aria-hidden>
                  {icon}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-stone-900 dark:text-stone-100 leading-snug">
                    {action.title}
                    {action.impactWeight && (
                      <ImpactTag weight={action.impactWeight} className="ml-1.5 align-middle" />
                    )}
                  </p>
                </div>

                {/* Service window countdown */}
                {action.serviceWindowMinutes != null && action.serviceWindowMinutes > 0 && (
                  <span className="shrink-0 text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                    ⏱ {fmtCountdown(action.serviceWindowMinutes)}
                  </span>
                )}
              </div>

              {/* Row 2 — problem statement */}
              <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug mb-1.5 pl-[calc(1.875rem+0.625rem)]">
                <span className="font-semibold text-stone-700 dark:text-stone-300">Problem: </span>
                {action.message}
              </p>

              {/* Row 3 — specific action */}
              {action.recommendation && (
                <p className="text-[11px] text-stone-500 dark:text-stone-500 leading-snug mb-1.5 pl-[calc(1.875rem+0.625rem)]">
                  <span className="font-semibold text-stone-600 dark:text-stone-400">Action: </span>
                  {action.recommendation}
                </p>
              )}

              {/* Row 4 — recovery metric */}
              {action.recoveryMetric && (
                <p className={cn(
                  "text-[11px] font-semibold leading-snug mb-2.5 pl-[calc(1.875rem+0.625rem)]",
                  action.isHighRisk
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-700 dark:text-amber-400"
                )}>
                  📍 {action.recoveryMetric}
                </p>
              )}

              {/* Row 5 — action buttons */}
              <div className="flex items-center gap-2 pl-[calc(1.875rem+0.625rem)]">
                {/* Execute */}
                <Link
                  href={action.primaryAction?.href ?? action.href}
                  className={cn(
                    "rounded px-2.5 py-1.5 text-[11px] font-bold leading-none whitespace-nowrap transition-colors",
                    action.severity === "critical" || action.isHighRisk
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : action.severity === "urgent"
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-white"
                  )}
                >
                  {action.primaryAction?.label ?? "Execute →"}
                </Link>

                {/* Assign (goes to Actions board) */}
                <Link
                  href="/dashboard/actions"
                  className="rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors ring-1 ring-stone-200 dark:ring-stone-700"
                >
                  Assign
                </Link>

                {/* Done (mark resolved via actions board) */}
                <Link
                  href="/dashboard/actions"
                  className="rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors ring-1 ring-emerald-200 dark:ring-emerald-800"
                >
                  ✓ Done
                </Link>
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}
