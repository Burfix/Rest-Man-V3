/**
 * AttentionPanel — "Needs Attention Now"
 *
 * High-priority action table with severity badge, title, reason,
 * owner, due date, and a quick-action link — rendered as a dense list.
 * Derives items from the same buildPriorityActions engine but enriches
 * each item with an owner role and due-date label.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import SeverityBadge from "@/components/ui/SeverityBadge";
import type { SeverityLevel } from "@/components/ui/SeverityBadge";
import type { DashboardAction } from "@/lib/commandCenter";

// ── Owner + due-date derivation ────────────────────────────────────────────────

const CATEGORY_OWNER: Record<string, string> = {
  compliance:  "Operations Manager",
  maintenance: "Facilities Manager",
  revenue:     "F&B Manager",
  staffing:    "Floor Manager",
  events:      "Events Coordinator",
  data:        "Operations Manager",
};

const CATEGORY_DUE: Record<string, (sev: string) => string> = {
  compliance:  (s) => s === "critical" ? "Immediate" : "This week",
  maintenance: (s) => s === "critical" || s === "urgent" ? "Today"     : "This week",
  revenue:     ()  => "Today",
  staffing:    ()  => "Before next service",
  events:      ()  => "Before tonight",
  data:        ()  => "End of day",
};

function getOwner(category: string):  string { return CATEGORY_OWNER[category] ?? "Manager"; }
function getDue(category: string, severity: string): string {
  return CATEGORY_DUE[category]?.(severity) ?? "ASAP";
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  actions: DashboardAction[];
}

export default function AttentionPanel({ actions }: Props) {
  const top = actions.slice(0, 7); // max 7 at once

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-stone-50">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">⚡</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-700">
            Needs Attention Now
          </span>
        </div>
        {top.length > 0 ? (
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold",
            top.some((a) => a.severity === "critical") ? "bg-red-600 text-white" :
            top.some((a) => a.severity === "urgent")   ? "bg-amber-500 text-white" :
            "bg-stone-200 text-stone-700"
          )}>
            {top.length} item{top.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            All clear
          </span>
        )}
      </div>

      {/* All-clear state */}
      {top.length === 0 && (
        <div className="flex items-center gap-3 px-5 py-6">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-sm font-semibold text-stone-700">No priority actions required</p>
            <p className="text-xs text-stone-400 mt-0.5">All operational areas are on track for today&apos;s service.</p>
          </div>
        </div>
      )}

      {/* Action rows */}
      {top.length > 0 && (
        <div className="divide-y divide-stone-100">
          {top.map((action, idx) => {
            const owner  = getOwner(action.category);
            const due    = getDue(action.category, action.severity);

            return (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-4 px-5 py-4 transition-colors hover:bg-stone-50",
                  action.severity === "critical" && "bg-red-50/40 hover:bg-red-50/60",
                  action.severity === "urgent"   && "bg-amber-50/30 hover:bg-amber-50/50"
                )}
              >
                {/* Severity badge — fixed width */}
                <div className="pt-0.5 shrink-0">
                  <SeverityBadge level={action.severity as SeverityLevel} />
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-900 leading-snug">
                    {action.title}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500 leading-relaxed">
                    {action.message}
                  </p>
                  <p className="mt-1 text-[11px] text-stone-400 italic">
                    {action.recommendation}
                  </p>
                </div>

                {/* Meta */}
                <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                    Owner
                  </p>
                  <p className="text-xs font-medium text-stone-700 whitespace-nowrap">{owner}</p>
                  <p className="text-[10px] text-stone-400 whitespace-nowrap">{due}</p>
                </div>

                {/* Quick action */}
                <div className="shrink-0 pt-0.5">
                  <Link
                    href={action.href}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold border transition-colors whitespace-nowrap",
                      action.severity === "critical"
                        ? "border-red-300 text-red-700 hover:bg-red-50"
                        : action.severity === "urgent"
                        ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                        : "border-stone-300 text-stone-700 hover:bg-stone-50"
                    )}
                  >
                    Resolve
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
