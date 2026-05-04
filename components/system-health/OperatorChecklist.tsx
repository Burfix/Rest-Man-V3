"use client";

import { useState, useEffect } from "react";
import type { ChecklistItem } from "@/lib/system-health/types";

interface OperatorChecklistProps {
  initialItems: ChecklistItem[];
}

function getTodayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function loadManualChecks(date: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`forgestack:checklist:${date}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveManualChecks(date: string, checks: Record<string, boolean>): void {
  try {
    localStorage.setItem(`forgestack:checklist:${date}`, JSON.stringify(checks));
  } catch {
    // storage may be unavailable
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  system:  "System",
  data:    "Data",
  ops:     "Operations",
  reports: "Reports",
};

export default function OperatorChecklist({ initialItems }: OperatorChecklistProps) {
  const today = getTodayKey();
  const [manualChecks, setManualChecks] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setManualChecks(loadManualChecks(today));
    setMounted(true);
  }, [today]);

  function toggle(item: ChecklistItem) {
    if (item.auto) return; // auto-checked items are not manually toggleable
    const next = { ...manualChecks, [item.id]: !manualChecks[item.id] };
    setManualChecks(next);
    saveManualChecks(today, next);
  }

  const resolvedItems = initialItems.map(item => ({
    ...item,
    checked: item.auto ? item.checked : (mounted ? !!manualChecks[item.id] : false),
  }));

  const checkedCount = resolvedItems.filter(i => i.checked).length;
  const total        = resolvedItems.length;
  const pct          = Math.round((checkedCount / total) * 100);

  const byCategory = Object.entries(CATEGORY_LABELS).map(([cat, label]) => ({
    category: cat,
    label,
    items: resolvedItems.filter(i => i.category === cat),
  })).filter(g => g.items.length > 0);

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Operator Checklist
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Daily checks — auto items update from live data. Manual items are saved for today.
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
              {checkedCount}/{total}
            </p>
            <p className="text-xs text-zinc-400">{pct}% complete</p>
          </div>
        </div>
        {/* progress bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-1.5 rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-zinc-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {byCategory.map(group => (
          <div key={group.category} className="px-6 py-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-3">
              {group.label}
            </p>
            {group.items.map(item => (
              <label
                key={item.id}
                className={`flex items-center gap-3 ${item.auto ? "cursor-default" : "cursor-pointer group"}`}
                onClick={() => toggle(item)}
              >
                {/* checkbox */}
                <div
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                    item.checked
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-zinc-300 dark:border-zinc-600"
                  } ${!item.auto ? "group-hover:border-zinc-400 dark:group-hover:border-zinc-500" : ""}`}
                >
                  {item.checked && (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-between">
                  <span className={`text-sm ${item.checked ? "line-through text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"}`}>
                    {item.label}
                  </span>
                  {item.auto && (
                    <span className="text-[10px] text-zinc-400 font-medium ml-2 flex-shrink-0">Auto</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800 px-6 py-3">
        <p className="text-xs text-zinc-400">
          Manual checks saved locally for {today}. Auto checks update on page refresh.
        </p>
      </div>
    </section>
  );
}
