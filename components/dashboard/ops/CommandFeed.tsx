/**
 * CommandFeed — The central manager addiction loop.
 *
 * Shows top 5 operational alerts as plain-English, action-oriented cards.
 * Sorted by urgency → revenue risk → service risk → immediacy.
 * Each card reads like a GM briefing, not a data report.
 *
 * This is the main focal point of the Operating Brain.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import ImpactTag from "@/components/ui/ImpactTag";
import type { CommandFeedItem } from "@/types/operating-brain";
import type { ActionSeverity, ActionCategory, ImpactWeight } from "@/lib/commandCenter";

interface Props {
  items: CommandFeedItem[];
  maxVisible?: number;
}

const SEVERITY: Record<ActionSeverity, {
  border: string;
  badge:  string;
  label:  string;
  pulse:  boolean;
}> = {
  critical: {
    border: "border-l-red-500",
    badge:  "bg-red-600 text-white",
    label:  "Critical",
    pulse:  true,
  },
  urgent: {
    border: "border-l-amber-500",
    badge:  "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300",
    label:  "Urgent",
    pulse:  true,
  },
  action: {
    border: "border-l-blue-400 dark:border-l-blue-500",
    badge:  "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    label:  "Action",
    pulse:  false,
  },
  watch: {
    border: "border-l-stone-300 dark:border-l-stone-600",
    badge:  "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
    label:  "Watch",
    pulse:  false,
  },
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

function fmtCountdown(mins: number): string {
  if (mins <= 0)  return "Expired";
  if (mins < 60)  return `${mins}m left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

export default function CommandFeed({ items, maxVisible = 5 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 sm:p-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-4">
          Command Feed
        </p>
        <p className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
          ✓ All clear — no issues requiring attention
        </p>
        <p className="text-xs text-stone-500 dark:text-stone-500 mt-1">
          The system is monitoring all operational signals
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-500 dark:text-stone-600">
            Command Feed
          </p>
          <span className="text-[10px] font-semibold text-stone-500 dark:text-stone-600">
            · {items.length} item{items.length !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="hidden sm:inline text-[10px] text-stone-500 dark:text-stone-500 italic">
          Sorted by urgency
        </span>
      </div>

      {/* Feed items */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800/60">
        {visible.map((item) => {
          const sev = SEVERITY[item.severity];
          const icon = CATEGORY_ICON[item.category];

          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "block border-l-[3px] px-4 sm:px-6 py-3 sm:py-4 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors",
                sev.border
              )}
            >
              {/* Severity + Category + Countdown */}
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2">
                <span className={cn(
                  "rounded-full px-2 py-px text-[10px] font-bold uppercase leading-tight",
                  sev.badge
                )}>
                  {sev.pulse && (
                    <span className="inline-block h-1 w-1 rounded-full bg-current animate-pulse mr-1 align-middle" />
                  )}
                  {sev.label}
                </span>
                <span className="text-xs">{icon}</span>
                {item.impactWeight && <ImpactTag weight={item.impactWeight} />}
                {item.serviceWindow != null && (
                  <span className="ml-auto text-[10px] font-semibold text-stone-500 dark:text-stone-500 tabular-nums">
                    {fmtCountdown(item.serviceWindow)}
                  </span>
                )}
              </div>

              {/* Title + Explanation */}
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug">
                {item.title}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 leading-relaxed">
                {item.explanation}
              </p>

              {/* Action + Impact */}
              <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 mt-2.5">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 flex-1">
                  → {item.action}
                </p>
                {item.impact && (
                  <span className="text-[10px] text-stone-500 dark:text-stone-500 shrink-0 sm:max-w-[40%] sm:text-right">
                    {item.impact}
                  </span>
                )}
              </div>

              {/* Recovery metric */}
              {item.recoveryMetric && (
                <p className="text-[10px] text-stone-500 dark:text-stone-500 mt-1.5 italic">
                  Target: {item.recoveryMetric}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      {/* Show more */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-6 py-3 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-stone-50 dark:hover:bg-stone-800/40 border-t border-stone-100 dark:border-stone-800 transition-colors"
        >
          {expanded ? "Show fewer" : `Show ${items.length - maxVisible} more`}
        </button>
      )}
    </div>
  );
}
