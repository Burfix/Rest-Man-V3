/**
 * ReviewActionsPanel
 *
 * Shows review-generated tasks grouped by department.
 * Client component — tasks can be dismissed inline.
 */

"use client";

import { cn } from "@/lib/utils";

type ReviewAction = {
  id:          string;
  title:       string;
  description?: string | null;
  department:  string;
  priority:    string;
  status:      string;
  due_date?:   string | null;
};

type Props = {
  actions: ReviewAction[];
};

const deptIcon: Record<string, string> = {
  housekeeping: "🧹",
  front_desk:   "🛎",
  maintenance:  "🔧",
  management:   "👔",
  reservations: "📋",
};

const priorityStyle: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20",
  high:     "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/20",
  medium:   "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20",
  low:      "text-stone-500 bg-stone-100 dark:bg-stone-800",
};

const DEPT_ORDER = ["management", "housekeeping", "maintenance", "front_desk", "reservations"];

export default function ReviewActionsPanel({ actions }: Props) {
  const open = actions.filter((a) => a.status === "open" || a.status === "in_progress");

  if (open.length === 0) {
    return (
      <div className="border border-[#e2e2e0] dark:border-stone-800 p-5">
        <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-600 block mb-3">
          REVIEW ACTIONS
        </span>
        <p className="text-sm text-stone-400">No open actions</p>
      </div>
    );
  }

  // Group by department
  const byDept: Record<string, ReviewAction[]> = {};
  for (const a of open) {
    (byDept[a.department] ??= []).push(a);
  }

  const orderedDepts = DEPT_ORDER.filter((d) => byDept[d]);

  return (
    <div className="border border-[#e2e2e0] dark:border-stone-800 bg-white dark:bg-[#0f0f0f]">
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between border-b border-[#e2e2e0] dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-600">
          REVIEW ACTIONS
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-950/20 px-2 py-0.5 text-[9px] font-mono font-bold text-orange-600 dark:text-orange-400">
          {open.length} OPEN
        </span>
      </div>

      <div className="divide-y divide-[#e2e2e0] dark:divide-stone-800">
        {orderedDepts.map((dept) => (
          <div key={dept} className="px-5 py-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{deptIcon[dept] ?? "📌"}</span>
              <span className="text-[9px] uppercase tracking-wider font-medium text-stone-600 capitalize">
                {dept.replace(/_/g, " ")}
              </span>
            </div>
            {byDept[dept].map((action) => (
              <div key={action.id} className="pl-5 space-y-0.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-medium text-stone-700 dark:text-stone-300 leading-snug">
                    {action.title}
                  </p>
                  <span className={cn(
                    "flex-shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase",
                    priorityStyle[action.priority] ?? priorityStyle.medium,
                  )}>
                    {action.priority}
                  </span>
                </div>
                {action.description && (
                  <p className="text-[10px] text-stone-400 leading-snug">{action.description}</p>
                )}
                {action.due_date && (
                  <p className="text-[9px] font-mono text-stone-400">Due {action.due_date}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
