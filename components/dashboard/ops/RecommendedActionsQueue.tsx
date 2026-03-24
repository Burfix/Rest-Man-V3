/**
 * RecommendedActionsQueue — Execution-oriented action list.
 *
 * Groups actions into temporal buckets: Now, This Shift, Today, This Week.
 * Each action shows title, urgency, owner, due time, why, impact, status.
 * Replaces the "Priority Action Center" naming.
 */

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import ImpactTag from "@/components/ui/ImpactTag";
import type { DashboardAction, ActionSeverity, ActionCategory } from "@/lib/commandCenter";

interface Props {
  actions: DashboardAction[];
}

const SEVERITY_STYLE: Record<ActionSeverity, { dot: string; text: string }> = {
  critical: { dot: "bg-red-500",                  text: "text-red-600 dark:text-red-400" },
  urgent:   { dot: "bg-amber-500",                text: "text-amber-600 dark:text-amber-400" },
  action:   { dot: "bg-blue-400 dark:bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  watch:    { dot: "bg-stone-300 dark:bg-stone-600", text: "text-stone-500 dark:text-stone-400" },
};

const CATEGORY_ICON: Record<ActionCategory, string> = {
  compliance:  "📋",
  maintenance: "🔧",
  inventory:   "📦",
  revenue:     "📈",
  staffing:    "👥",
  events:      "🎭",
  data:        "📊",
};

type TimeBucket = "now" | "this_shift" | "today" | "this_week";

function bucketAction(action: DashboardAction): TimeBucket {
  if (action.severity === "critical") return "now";
  if (action.serviceWindowMinutes != null && action.serviceWindowMinutes <= 120) return "this_shift";
  if (action.severity === "urgent") return "this_shift";
  if (action.severity === "action") return "today";
  return "this_week";
}

const BUCKET_CONFIG: Record<TimeBucket, { label: string; sublabel: string }> = {
  now:        { label: "Now",        sublabel: "Requires immediate attention" },
  this_shift: { label: "This Shift", sublabel: "Before service ends" },
  today:      { label: "Today",      sublabel: "Complete before close" },
  this_week:  { label: "This Week",  sublabel: "Schedule this week" },
};

export default function RecommendedActionsQueue({ actions }: Props) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const markDone = useCallback((id: string) => {
    setCompletedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Group into buckets
  const buckets = new Map<TimeBucket, DashboardAction[]>();
  for (const a of actions) {
    const b = bucketAction(a);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b)!.push(a);
  }

  const bucketOrder: TimeBucket[] = ["now", "this_shift", "today", "this_week"];

  if (actions.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 sm:p-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-3">
          Recommended Actions
        </p>
        <p className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
          ✓ No actions pending
        </p>
        <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
          All operational areas are within acceptable ranges
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-stone-100 dark:border-stone-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600">
          Recommended Actions
        </p>
        {completedIds.size > 0 && (
          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            {completedIds.size} resolved
          </span>
        )}
      </div>

      {/* Bucketed actions */}
      {bucketOrder.map((bucket) => {
        const items = buckets.get(bucket);
        if (!items || items.length === 0) return null;

        return (
          <div key={bucket}>
            {/* Bucket header */}
            <div className="flex items-center gap-2 px-4 sm:px-6 py-2.5 bg-stone-50 dark:bg-stone-800/30 border-b border-stone-100 dark:border-stone-800">
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-500">
                {BUCKET_CONFIG[bucket].label}
              </span>
              <span className="text-[10px] text-stone-400 dark:text-stone-600">
                — {BUCKET_CONFIG[bucket].sublabel}
              </span>
              <span className="ml-auto text-[10px] font-semibold text-stone-400 dark:text-stone-600">
                {items.length}
              </span>
            </div>

            {/* Action items */}
            <div className="divide-y divide-stone-100 dark:divide-stone-800/60">
              {items.map((action, i) => {
                const id = `${bucket}-${i}`;
                const isDone = completedIds.has(id);
                const sev = SEVERITY_STYLE[action.severity];
                const icon = CATEGORY_ICON[action.category];

                return (
                  <div
                    key={id}
                    className={cn(
                      "flex items-start gap-3 px-4 sm:px-6 py-3 sm:py-3.5 transition-all",
                      isDone && "opacity-40"
                    )}
                  >
                    {/* Done checkbox */}
                    <button
                      onClick={() => markDone(id)}
                      disabled={isDone}
                      className={cn(
                        "mt-0.5 h-5 w-5 sm:mt-1 sm:h-4 sm:w-4 shrink-0 rounded border transition-colors",
                        isDone
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-stone-300 dark:border-stone-600 hover:border-blue-400 dark:hover:border-blue-500"
                      )}
                      aria-label={isDone ? "Completed" : "Mark as done"}
                    >
                      {isDone && (
                        <svg viewBox="0 0 12 12" className="h-full w-full text-white">
                          <path d="M2.5 6l2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", sev.dot)} />
                        <span className="text-xs">{icon}</span>
                        <span className={cn("text-[10px] font-bold uppercase", sev.text)}>
                          {action.severity}
                        </span>
                        {action.impactWeight && <ImpactTag weight={action.impactWeight} />}
                      </div>
                      <p className={cn(
                        "text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug",
                        isDone && "line-through"
                      )}>
                        {action.title}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                        {action.message}
                      </p>
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1.5">
                        → {action.recommendation}
                      </p>
                      {action.recoveryMetric && (
                        <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1 italic">
                          {action.recoveryMetric}
                        </p>
                      )}
                    </div>

                    {/* Link */}
                    <Link
                      href={action.href}
                      className="shrink-0 mt-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      View →
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
