/**
 * ActionQueueGroup — Groups actions by time horizon.
 *
 * Each action row shows: title, urgency badge, category, why it matters,
 * expected impact, owner, due time, action buttons.
 * A manager should work through this like a shift checklist.
 */

"use client";

import { cn } from "@/lib/utils";
import type { Action } from "@/types/actions";
import ActionImpactPill from "./ActionImpactPill";
import type { ImpactType } from "./ActionImpactPill";

type Props = {
  title: string;
  actions: Action[];
  onStatusChange?: (id: string, status: "in_progress" | "completed") => void;
};

const PRIORITY_STYLES: Record<string, { badge: string; dot: string }> = {
  critical: { badge: "bg-red-500/15 text-red-400", dot: "bg-red-400 animate-pulse" },
  high:     { badge: "bg-orange-500/15 text-orange-400", dot: "bg-orange-400" },
  medium:   { badge: "bg-amber-500/15 text-amber-400", dot: "bg-amber-400" },
  low:      { badge: "bg-stone-500/15 text-stone-400", dot: "bg-stone-500" },
};

const CATEGORY_LABEL: Record<string, string> = {
  revenue: "Revenue",
  labour: "Labour",
  food_cost: "Food Cost",
  stock: "Stock",
  maintenance: "Maintenance",
  compliance: "Compliance",
  daily_ops: "Ops",
  service: "Service",
  general: "General",
};

function mapImpactType(cat: string): ImpactType {
  if (cat === "revenue" || cat === "food_cost") return "revenue_protected";
  if (cat === "service" || cat === "maintenance") return "service_protected";
  if (cat === "labour") return "cost_saved";
  if (cat === "compliance") return "compliance_risk";
  return "monitor";
}

export default function ActionQueueGroup({
  title,
  actions,
  onStatusChange,
}: Props) {
  if (actions.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-xs uppercase tracking-widest text-stone-500 font-medium">
          {title}
        </h3>
        <span className="rounded-full bg-stone-800 px-2 py-0.5 text-[10px] text-stone-400 font-mono">
          {actions.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {actions.map((action) => {
          const prio = PRIORITY_STYLES[action.impact_weight] ?? PRIORITY_STYLES.medium;
          return (
            <div
              key={action.id}
              className="rounded-lg border border-stone-800/40 bg-stone-900/50 px-4 py-3"
            >
              {/* Top row: priority + category + due */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", prio.badge)}>
                    {action.impact_weight}
                  </span>
                  <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                    {(action.category && CATEGORY_LABEL[action.category]) ?? action.category ?? "General"}
                  </span>
                </div>
                {action.due_at && (
                  <span className="text-[10px] text-stone-500 font-mono shrink-0">
                    {new Date(action.due_at).toLocaleTimeString("en-ZA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              {/* Title */}
              <h4 className="text-sm font-semibold text-stone-100 leading-snug">
                {action.title}
              </h4>

              {/* Why it matters */}
              {action.why_it_matters && (
                <p className="text-xs text-stone-400 mt-1 leading-relaxed">
                  {action.why_it_matters}
                </p>
              )}

              {/* Impact + owner + actions row */}
              <div className="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <ActionImpactPill
                    type={mapImpactType(action.category ?? "general")}
                    label={action.expected_impact ?? undefined}
                  />
                  {action.assigned_to && (
                    <span className="text-[10px] text-stone-500">
                      → {action.assigned_to}
                    </span>
                  )}
                </div>

                {/* Action buttons */}
                {onStatusChange && action.status !== "completed" && (
                  <div className="flex items-center gap-1.5">
                    {action.status === "pending" && (
                      <button
                        onClick={() => onStatusChange(action.id, "in_progress")}
                        className="rounded-md bg-stone-800 px-2.5 py-1 text-[10px] font-medium text-stone-300 hover:bg-stone-700 transition-colors"
                      >
                        Start
                      </button>
                    )}
                    <button
                      onClick={() => onStatusChange(action.id, "completed")}
                      className="rounded-md bg-emerald-600/20 px-2.5 py-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
