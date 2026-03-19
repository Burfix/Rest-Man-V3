/**
 * PriorityActionCenter — Zone 3
 *
 * Auto-generated action cards sorted by severity.
 * Maximum 5 actions rendered. Empty state shows a "✓ All clear" message.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DashboardAction, ActionSeverity } from "@/lib/commandCenter";

interface Props {
  actions: DashboardAction[];
}

const SEVERITY_CONFIG: Record<
  ActionSeverity,
  { label: string; bg: string; text: string; dot: string; border: string }
> = {
  critical: {
    label:  "CRITICAL",
    bg:     "bg-red-50",
    text:   "text-red-700",
    dot:    "bg-red-600 animate-pulse",
    border: "border-red-200",
  },
  urgent: {
    label:  "URGENT",
    bg:     "bg-amber-50",
    text:   "text-amber-700",
    dot:    "bg-amber-500",
    border: "border-amber-200",
  },
  action: {
    label:  "ACTION",
    bg:     "bg-blue-50",
    text:   "text-blue-700",
    dot:    "bg-blue-500",
    border: "border-blue-200",
  },
  watch: {
    label:  "WATCH",
    bg:     "bg-stone-50",
    text:   "text-stone-500",
    dot:    "bg-stone-400",
    border: "border-stone-200",
  },
};

export default function PriorityActionCenter({ actions }: Props) {
  const topActions = actions.slice(0, 5);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">
          Priority Action Center
        </p>
        {topActions.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
            {topActions.length} action{topActions.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {topActions.length === 0 ? (
        <AllClearCard />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {topActions.map((action, i) => (
            <ActionCard key={i} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllClearCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
      <span className="text-2xl">✅</span>
      <div>
        <p className="text-sm font-semibold text-emerald-800">All systems clear</p>
        <p className="text-xs text-emerald-600">No priority actions required at this time.</p>
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: DashboardAction }) {
  const cfg = SEVERITY_CONFIG[action.severity];

  return (
    <Link
      href={action.href}
      className={cn(
        "group flex flex-col rounded-xl border p-4 transition-all hover:shadow-md",
        cfg.bg,
        cfg.border
      )}
    >
      {/* Badge */}
      <div className="mb-2 flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full shrink-0", cfg.dot)} />
        <span className={cn("text-[10px] font-bold uppercase tracking-widest", cfg.text)}>
          {cfg.label}
        </span>
      </div>

      {/* Title */}
      <p className={cn("text-sm font-bold leading-snug", cfg.text)}>
        {action.title}
      </p>

      {/* Message */}
      <p className="mt-1.5 text-xs text-stone-600 leading-relaxed flex-1">
        {action.message}
      </p>

      {/* Recommendation */}
      <p className="mt-2 text-[11px] font-medium text-stone-500 italic leading-relaxed">
        {action.recommendation}
      </p>

      {/* CTA */}
      <span className={cn(
        "mt-3 text-xs font-semibold group-hover:underline",
        cfg.text
      )}>
        Take Action →
      </span>
    </Link>
  );
}
