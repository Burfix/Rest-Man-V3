/**
 * AllDecisions — Scrollable list of all decisions beyond the top 3.
 *
 * Compact format with severity indicators and action buttons.
 */

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { GMDecision, GMDecisionSeverity } from "@/lib/copilot/types";

type Props = {
  decisions: GMDecision[];
};

const SEV_DOT: Record<GMDecisionSeverity, string> = {
  critical: "bg-red-400",
  high: "bg-amber-400",
  medium: "bg-stone-400",
  low: "bg-stone-600",
};

const CAT_LABEL: Record<string, string> = {
  service: "Service",
  revenue: "Revenue",
  labour: "Labour",
  bookings: "Bookings",
  inventory: "Inventory",
  compliance: "Compliance",
  maintenance: "Maintenance",
  data: "Data",
};

export default function AllDecisions({ decisions }: Props) {
  const remaining = decisions.slice(3);
  const [expanded, setExpanded] = useState(false);

  if (remaining.length === 0) return null;

  const shown = expanded ? remaining : remaining.slice(0, 5);

  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-stone-500 font-medium px-1">
        All Decisions ({decisions.length})
      </h2>
      <div className="rounded-xl border border-stone-800/40 bg-stone-900/50 divide-y divide-stone-800/30">
        {shown.map((d) => (
          <CompactDecision key={d.id} decision={d} />
        ))}
      </div>
      {remaining.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-stone-500 hover:text-stone-300 px-1 transition-colors"
        >
          {expanded ? "Show less" : `Show ${remaining.length - 5} more`}
        </button>
      )}
    </div>
  );
}

function CompactDecision({ decision: d }: { decision: GMDecision }) {
  const [status, setStatus] = useState(d.status);

  async function handleComplete() {
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: d.title,
          description: d.directInstruction,
          category: d.category,
          priority: d.severity,
          status: "done",
          source: "copilot",
        }),
      });
      if (res.ok) setStatus("completed");
    } catch {
      // Silent fallback
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Rank */}
      <span className="text-[10px] font-mono text-stone-600 w-4 flex-shrink-0 text-right">
        {d.priorityRank}
      </span>

      {/* Severity dot */}
      <div className={cn("h-2 w-2 rounded-full flex-shrink-0", SEV_DOT[d.severity])} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-stone-200 truncate">{d.title}</p>
        <p className="text-[11px] text-stone-500 truncate">{d.directInstruction}</p>
      </div>

      {/* Category */}
      <span className="text-[10px] text-stone-500 flex-shrink-0">
        {CAT_LABEL[d.category] ?? d.category}
      </span>

      {/* Action */}
      {status === "completed" ? (
        <span className="text-[10px] text-emerald-400 flex-shrink-0">✓</span>
      ) : (
        <button
          onClick={handleComplete}
          className="text-[10px] text-stone-500 hover:text-emerald-400 flex-shrink-0 transition-colors"
        >
          Done
        </button>
      )}
    </div>
  );
}
