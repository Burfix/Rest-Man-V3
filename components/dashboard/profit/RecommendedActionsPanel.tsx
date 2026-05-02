/**
 * components/dashboard/profit/RecommendedActionsPanel.tsx
 *
 * Displays profit-driven recommended actions and allows one-click
 * creation of an action record via POST /api/actions.
 */

"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { ProfitAction } from "@/lib/profit/types";

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high:     "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  medium:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low:      "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

function ActionCard({
  action,
  onCreateAction,
}: {
  action: ProfitAction;
  onCreateAction: (a: ProfitAction) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();
  const [created, setCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    startTransition(async () => {
      setError(null);
      try {
        await onCreateAction(action);
        setCreated(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create action");
      }
    });
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              SEVERITY_BADGE[action.severity] ?? SEVERITY_BADGE.low,
            )}>
              {action.severity}
            </span>
            <span className="text-[10px] text-stone-400 uppercase tracking-wide font-semibold">
              {action.category.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 leading-snug">
            {action.title}
          </p>
          <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
            {action.directInstruction}
          </p>
          {action.expectedImpactText && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold mt-1.5">
              {action.expectedImpactText}
            </p>
          )}
        </div>

        <div className="shrink-0">
          {created ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.485 1.929a.75.75 0 011.06 1.06L6.5 11.034 2.454 6.99a.75.75 0 111.06-1.06L6.5 8.914l6.985-6.985z"/>
              </svg>
              Created
            </span>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isPending}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors",
                "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900",
                "hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50",
              )}
            >
              {isPending ? "Creating…" : "Create Action"}
            </button>
          )}
          {error && (
            <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 max-w-[120px] leading-tight">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RecommendedActionsPanel({
  actions,
  siteId,
}: {
  actions: ProfitAction[];
  siteId: string;
}) {
  async function handleCreateAction(action: ProfitAction) {
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: action.title,
        direct_instruction: action.directInstruction,
        category: action.category,
        severity: action.severity,
        source_type: "profit_intelligence",
        expected_impact_text: action.expectedImpactText,
        expected_impact_value: action.expectedImpactValue ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to create action");
    }
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 text-center">
        <p className="text-sm text-stone-500">No profit actions recommended right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">
          Recommended Profit Actions
        </h2>
        <p className="text-[11px] text-stone-500 mt-0.5">
          Operational steps to protect margin now
        </p>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {actions.map((a) => (
          <ActionCard key={a.id} action={a} onCreateAction={handleCreateAction} />
        ))}
      </div>
    </div>
  );
}
