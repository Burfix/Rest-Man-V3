/**
 * DataHealthIndicator — Compact data freshness summary.
 *
 * Replaces scattered freshness pills with one summarised status:
 * Good / Some delays / Stale — with expandable detail per source.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EvaluateOperationsOutput } from "@/services/decision-engine";

type Props = {
  health: EvaluateOperationsOutput["dataHealth"];
};

const STATUS_STYLES = {
  good:    { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400", label: "All data current" },
  warning: { bg: "bg-amber-500/10",   text: "text-amber-400",   dot: "bg-amber-400",   label: "Some delays" },
  stale:   { bg: "bg-red-500/10",     text: "text-red-400",     dot: "bg-red-400",     label: "Stale data" },
};

const TONE_DOT: Record<string, string> = {
  positive: "bg-emerald-400",
  warning: "bg-amber-400",
  critical: "bg-red-400",
};

export default function DataHealthIndicator({ health }: Props) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_STYLES[health.status];

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        Data Health
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
            <span className={cn("text-sm font-semibold", cfg.text)}>
              {cfg.label}
            </span>
          </div>
          <span className="text-stone-600 text-xs">{open ? "▲" : "▼"}</span>
        </button>

        {/* Summary */}
        <p className="px-4 pb-2 text-[11px] text-stone-500 leading-snug -mt-1">
          {health.summary}
        </p>

        {/* Expandable details */}
        {open && (
          <div className="border-t border-stone-800/40 px-4 py-2 space-y-1.5">
            {health.details.map((d) => (
              <div key={d.source} className="flex items-center justify-between text-xs">
                <span className="text-stone-400">{d.source}</span>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[d.tone] ?? "bg-stone-600")} />
                  <span className="text-stone-300 font-mono text-[11px]">{d.label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
