/**
 * CriticalActionsPanel — GM Morning Briefing
 *
 * Displays the top operational actions ranked by severity & business impact.
 * Powered by buildPriorityActions() from lib/commandCenter.ts.
 *
 * This is the first major focus zone on the dashboard — it must feel urgent,
 * decisive and immediately actionable. The GM's digital pre-shift briefing.
 *
 * Each row now surfaces a contextual primary action button inline (right side)
 * with optional secondary actions. Actions depend on the action type.
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
  monitor: {
    accent: "border-l-stone-300 dark:border-l-stone-600",
    badge:  "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 ring-1 ring-stone-200 dark:ring-stone-700",
    label:  "Monitor",
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

export default function CriticalActionsPanel({ actions }: Props) {
  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-4">
        <span className="text-xl shrink-0" aria-hidden>✅</span>
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            No critical actions required
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-600 mt-0.5">
            All operational areas are in order. Continue monitoring throughout service.
          </p>
        </div>
      </div>
    );
  }

  const criticalCount = actions.filter((a) => a.severity === "critical").length;
  const urgentCount   = actions.filter((a) => a.severity === "urgent").length;

  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
            Critical Actions
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
        {actions.slice(0, 6).map((action, idx) => {
          const cfg  = SEVERITY[action.severity];
          const icon = CATEGORY_ICON[action.category] ?? "⚠️";
          return (
            <div
              key={idx}
              className={cn(
                "flex items-start gap-3 border-l-2 px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors",
                cfg.accent
              )}
            >
              {/* Severity badge */}
              <span className={cn(
                "mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider leading-none",
                cfg.badge
              )}>
                {cfg.label}
                {cfg.pulse && (
                  <span className="ml-1 inline-block h-1 w-1 rounded-full bg-current align-middle opacity-80 animate-pulse" />
                )}
              </span>

              {/* Category icon */}
              <span className="text-base shrink-0 mt-0.5 leading-none select-none" aria-hidden>
                {icon}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 leading-tight">
                  {action.title}
                  {action.impactWeight && (
                    <ImpactTag weight={action.impactWeight} className="ml-1.5 align-middle" />
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-500 leading-snug">
                  {action.message}
                </p>
                {action.recommendation && (
                  <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-600 leading-snug italic">
                    → {action.recommendation}
                  </p>
                )}
              </div>

              {/* CTA — contextual primary action or generic View */}
              <div className="shrink-0 mt-0.5 flex items-center gap-2">
                {action.primaryAction ? (
                  <Link
                    href={action.primaryAction.href}
                    className={cn(
                      "rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap transition-colors",
                      action.severity === "critical"
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : action.severity === "urgent"
                        ? "bg-amber-500 text-white hover:bg-amber-600"
                        : "bg-stone-900 text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
                    )}
                  >
                    {action.primaryAction.label}
                  </Link>
                ) : (
                  <Link
                    href={action.href}
                    className="shrink-0 text-[11px] font-semibold text-stone-500 dark:text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 whitespace-nowrap transition-colors"
                  >
                    View →
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </section>
  );
}
