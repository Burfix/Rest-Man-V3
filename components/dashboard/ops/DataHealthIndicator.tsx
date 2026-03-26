/**
 * DataHealthIndicator — Replaces the row of many freshness pills.
 *
 * One compact component showing:
 * - Overall data health status (healthy / degraded / stale)
 * - Latest sales sync age
 * - Latest labour sync age
 * - Stale systems warning
 *
 * Supports a detail popover for full freshness breakdown.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DataFreshnessSummary, FreshnessItem } from "@/services/ops/dataFreshness";

interface Props {
  freshness:     DataFreshnessSummary;
  microsIsLive?: boolean;
  labourSyncAge?: string;
}

function ageLabel(item: FreshnessItem): string {
  if (item.daysAgo === null) return "—";
  if (item.daysAgo === 0) return "Today";
  if (item.daysAgo === 1) return "1d ago";
  return `${item.daysAgo}d ago`;
}

export default function DataHealthIndicator({ freshness, microsIsLive, labourSyncAge }: Props) {
  const [showDetail, setShowDetail] = useState(false);

  const allItems = [
    freshness.sales,
    freshness.reviews,
    freshness.maintenance,
    freshness.stock,
    freshness.compliance,
  ];
  const staleCount = allItems.filter(i => i.stale).length;
  const overall = staleCount >= 3 ? "stale" : staleCount > 0 ? "degraded" : "healthy";

  const STATUS_CONFIG = {
    healthy:  { dot: "bg-emerald-500", text: "Healthy",  style: "text-emerald-600 dark:text-emerald-500" },
    degraded: { dot: "bg-amber-500",   text: "Degraded", style: "text-amber-600 dark:text-amber-400" },
    stale:    { dot: "bg-red-500",     text: "Stale",    style: "text-red-600 dark:text-red-400" },
  };

  const cfg = STATUS_CONFIG[overall];

  return (
    <div className="relative">
      {/* Compact bar */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="flex flex-wrap items-center gap-2 sm:gap-3 w-full text-left group"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 shrink-0">
          Data Health
        </span>
        <span className="text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
        <span className={cn("flex items-center gap-1.5 text-[11px] font-semibold", cfg.style)}>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
          {cfg.text}
        </span>

        {/* Quick summary chips */}
        <span className="hidden sm:inline text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
        <span className="hidden sm:flex items-center gap-2 text-[10px] text-stone-400 dark:text-stone-500">
          <span>Sales: <span className={cn("font-medium", freshness.sales.stale ? "text-red-500" : "text-stone-600 dark:text-stone-400")}>{ageLabel(freshness.sales)}</span></span>
          {labourSyncAge && (
            <span>Labour: <span className="font-medium text-stone-600 dark:text-stone-400">{labourSyncAge}</span></span>
          )}
          {microsIsLive && (
            <span className="flex items-center gap-1">
              <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium text-emerald-600 dark:text-emerald-400">POS Live</span>
            </span>
          )}
        </span>

        {staleCount > 0 && (
          <>
            <span className="text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
            <span className="text-[10px] text-red-500 dark:text-red-400 font-medium">
              {staleCount} stale
            </span>
          </>
        )}

        <span className="ml-auto text-[10px] text-stone-300 dark:text-stone-600 group-hover:text-stone-400 dark:group-hover:text-stone-500 transition-colors">
          {showDetail ? "▲" : "▼"}
        </span>
      </button>

      {/* Detail popover */}
      {showDetail && (
        <div className="mt-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-4 shadow-lg">
          <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 dark:text-stone-600 mb-3">
            System Freshness Detail
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {allItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="flex items-center gap-2 rounded-lg border border-stone-100 dark:border-stone-800 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  item.stale ? "bg-red-400" : "bg-emerald-400"
                )} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                    {item.label}
                  </p>
                  <p className={cn(
                    "text-[10px]",
                    item.stale ? "text-red-500 dark:text-red-400" : "text-stone-400 dark:text-stone-500"
                  )}>
                    {ageLabel(item)}
                    {item.stale && " — action needed"}
                  </p>
                </div>
              </a>
            ))}
            {/* MICROS chip */}
            {(microsIsLive || freshness.micros.configured) && (
              <a
                href="/dashboard/settings/integrations"
                className="flex items-center gap-2 rounded-lg border border-stone-100 dark:border-stone-800 px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
              >
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  microsIsLive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                )} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                    POS Feed
                  </p>
                  <p className={cn(
                    "text-[10px]",
                    microsIsLive ? "text-emerald-500" : "text-amber-500"
                  )}>
                    {microsIsLive ? "Connected" : "Offline"}
                  </p>
                </div>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
