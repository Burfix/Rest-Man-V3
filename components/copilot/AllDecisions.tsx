/**
 * AllDecisions — Scrollable list of all decisions beyond the top 3.
 * Command Center design language — flat list, → execute link, no rounded-xl.
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
  high:     "bg-amber-400",
  medium:   "bg-stone-500",
  low:      "bg-stone-700",
};

const CAT_LABEL: Record<string, string> = {
  service:     "Service",
  revenue:     "Revenue",
  labour:      "Labour",
  bookings:    "Bookings",
  compliance:  "Compliance",
  maintenance: "Maintenance",
  data:        "Data",
};

export default function AllDecisions({ decisions }: Props) {
  const remaining = decisions.slice(3);
  const [expanded, setExpanded] = useState(false);

  if (remaining.length === 0) return null;

  const shown = expanded ? remaining : remaining.slice(0, 5);

  return (
    <div className="space-y-2">
      <h2 className="text-[9px] uppercase tracking-[0.2em] text-stone-600 font-semibold px-1">
        All Decisions ({decisions.length})
      </h2>
      <div className="border border-[#1a1a1a] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
        {shown.map((d) => (
          <CompactDecision key={d.id} decision={d} />
        ))}
      </div>
      {remaining.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] font-mono text-stone-600 hover:text-stone-400 px-1 transition-colors"
        >
          {expanded ? "↑ show less" : `↓ ${remaining.length - 5} more`}
        </button>
      )}
    </div>
  );
}

function CompactDecision({ decision: d }: { decision: GMDecision }) {
  const [status, setStatus] = useState(d.status);
  const [actionId, setActionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    if (loading) return;
    setLoading(true);
    try {
      if (!actionId) {
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: d.title,
            direct_instruction: d.directInstruction,
            category: d.category,
            severity: d.severity,
            status: "completed",
            owner: d.owner,
            source_type: "copilot",
            expected_impact_text: d.expectedImpactText,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          setActionId(json.action.id);
          setStatus("completed");
        }
      } else {
        const res = await fetch(`/api/actions/${actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        });
        if (res.ok) setStatus("completed");
      }
    } catch {
      // Silent fallback
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      {/* Rank */}
      <span className="text-[10px] font-mono text-stone-700 w-4 flex-shrink-0 text-right">
        {d.priorityRank}
      </span>

      {/* Severity dot */}
      <div className={cn("h-1.5 w-1.5 flex-shrink-0", SEV_DOT[d.severity])} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-stone-300 truncate">{d.title}</p>
        <p className="text-[10px] text-stone-600 truncate">{d.directInstruction}</p>
      </div>

      {/* Category */}
      <span className="text-[9px] uppercase tracking-wider text-stone-600 flex-shrink-0">
        {CAT_LABEL[d.category] ?? d.category}
      </span>

      {/* Action */}
      {status === "completed" ? (
        <span className="text-[10px] font-mono text-emerald-500 flex-shrink-0">✓</span>
      ) : (
        <button
          onClick={handleComplete}
          disabled={loading}
          className="text-[10px] font-mono text-stone-600 hover:text-emerald-400 flex-shrink-0 transition-colors disabled:opacity-40"
        >
          {loading ? "…" : "→ execute"}
        </button>
      )}
    </div>
  );
}
