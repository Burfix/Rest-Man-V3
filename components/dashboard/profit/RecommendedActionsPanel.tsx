/**
 * components/dashboard/profit/RecommendedActionsPanel.tsx
 *
 * Playbook — profit-driven action queue for store managers.
 *
 * The highest-severity action gets "hero" treatment with a full-width CTA.
 * Remaining actions are compact rows below it.
 * Actions are queued via POST /api/actions with source_type "profit_intelligence".
 */

"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import type { ProfitAction } from "@/lib/profit/types";

// ── Severity config ───────────────────────────────────────────────────────────

const SEV_BORDER: Record<string, string> = {
  critical: "border-red-300 dark:border-red-800/60",
  high:     "border-orange-300 dark:border-orange-800/50",
  medium:   "border-amber-200 dark:border-amber-800/30",
  low:      "border-stone-200 dark:border-stone-700",
};

const SEV_BG: Record<string, string> = {
  critical: "bg-red-50 dark:bg-red-900/10",
  high:     "bg-orange-50 dark:bg-orange-900/10",
  medium:   "bg-white dark:bg-stone-900",
  low:      "bg-white dark:bg-stone-900",
};

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high:     "bg-orange-500 text-white",
  medium:   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  low:      "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

const SEV_IMPACT: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high:     "text-orange-600 dark:text-orange-400",
  medium:   "text-amber-700 dark:text-amber-400",
  low:      "text-stone-500",
};

const SEV_CTA_BTN: Record<string, string> = {
  critical: "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white",
  high:     "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white",
  medium:   "bg-stone-900 hover:bg-stone-700 text-white dark:bg-stone-100 dark:hover:bg-stone-300 dark:text-stone-900",
  low:      "bg-stone-900 hover:bg-stone-700 text-white dark:bg-stone-100 dark:hover:bg-stone-300 dark:text-stone-900",
};

// ── Shared queue action API call ──────────────────────────────────────────────

async function postAction(action: ProfitAction): Promise<void> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title:                action.title,
      direct_instruction:   action.directInstruction,
      category:             action.category,
      severity:             action.severity,
      source_type:          "profit_intelligence",
      expected_impact_text: action.expectedImpactText,
      expected_impact_value: action.expectedImpactValue ?? undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Failed to queue action");
  }
}

// ── Hero action card (highest severity) ──────────────────────────────────────

function HeroActionCard({ action }: { action: ProfitAction }) {
  const [isPending, startTransition] = useTransition();
  const [created, setCreated]        = useState(false);
  const [error, setError]            = useState<string | null>(null);

  function handleQueue() {
    startTransition(async () => {
      setError(null);
      try {
        await postAction(action);
        setCreated(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to queue action");
      }
    });
  }

  const sev = action.severity;

  return (
    <div className={cn(
      "rounded-xl border-2 p-5",
      SEV_BORDER[sev] ?? SEV_BORDER.low,
      SEV_BG[sev]    ?? "bg-white dark:bg-stone-900",
    )}>
      {/* Severity + category header */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
          SEV_BADGE[sev] ?? SEV_BADGE.low,
        )}>
          {sev === "critical" ? "⚠ Act Now" : sev === "high" ? "↑ High Priority" : sev}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-stone-400">
          {action.category.replace(/_/g, " ")}
        </span>
      </div>

      {/* Title */}
      <p className="text-[15px] font-extrabold text-stone-900 dark:text-stone-100 leading-snug mb-2">
        {action.title}
      </p>

      {/* Direct instruction */}
      <p className="text-[13px] text-stone-600 dark:text-stone-400 leading-relaxed mb-3">
        {action.directInstruction}
      </p>

      {/* Expected impact callout */}
      {action.expectedImpactText && (
        <div className="rounded-lg bg-white/80 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-700 px-3 py-2 mb-4">
          <p className="text-[9px] font-bold uppercase tracking-widest text-stone-400 mb-0.5">
            Expected impact
          </p>
          <p className={cn("text-[13px] font-semibold", SEV_IMPACT[sev] ?? SEV_IMPACT.low)}>
            {action.expectedImpactText}
          </p>
        </div>
      )}

      {/* CTA */}
      {created ? (
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.485 1.929a.75.75 0 011.06 1.06L6.5 11.034 2.454 6.99a.75.75 0 111.06-1.06L6.5 8.914l6.985-6.985z" />
          </svg>
          <span className="text-sm font-bold">Added to ops queue</span>
        </div>
      ) : (
        <>
          <button
            onClick={handleQueue}
            disabled={isPending}
            className={cn(
              "w-full rounded-xl py-3 text-sm font-black uppercase tracking-wide transition-all disabled:opacity-50",
              SEV_CTA_BTN[sev] ?? SEV_CTA_BTN.low,
            )}
          >
            {isPending ? "Adding to queue…" : "Add to Ops Queue →"}
          </button>
          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400 mt-2 text-center">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Secondary action row ──────────────────────────────────────────────────────

function SecondaryActionCard({ action }: { action: ProfitAction }) {
  const [isPending, startTransition] = useTransition();
  const [created, setCreated]        = useState(false);
  const [error, setError]            = useState<string | null>(null);

  function handleQueue() {
    startTransition(async () => {
      setError(null);
      try {
        await postAction(action);
        setCreated(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to queue action");
      }
    });
  }

  const sev = action.severity;

  return (
    <div className={cn(
      "rounded-xl border p-4",
      SEV_BORDER[sev] ?? SEV_BORDER.low,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              SEV_BADGE[sev] ?? SEV_BADGE.low,
            )}>
              {sev}
            </span>
            <span className="text-[10px] uppercase tracking-wide font-semibold text-stone-400">
              {action.category.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-[13px] font-bold text-stone-900 dark:text-stone-100 leading-snug">
            {action.title}
          </p>
          <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">
            {action.directInstruction}
          </p>
          {action.expectedImpactText && (
            <p className={cn("text-[11px] font-semibold mt-1.5", SEV_IMPACT[sev] ?? SEV_IMPACT.low)}>
              {action.expectedImpactText}
            </p>
          )}
        </div>

        {/* Queue button */}
        <div className="shrink-0 flex flex-col items-end gap-1">
          {created ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.485 1.929a.75.75 0 011.06 1.06L6.5 11.034 2.454 6.99a.75.75 0 111.06-1.06L6.5 8.914l6.985-6.985z" />
              </svg>
              Queued
            </span>
          ) : (
            <button
              onClick={handleQueue}
              disabled={isPending}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors",
                "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900",
                "hover:bg-stone-700 dark:hover:bg-stone-300 disabled:opacity-50",
              )}
            >
              {isPending ? "Adding…" : "Queue It"}
            </button>
          )}
          {error && (
            <p className="text-[10px] text-red-600 dark:text-red-400 leading-tight max-w-[110px] text-right">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RecommendedActionsPanel({
  actions,
  siteId: _siteId,
}: {
  actions: ProfitAction[];
  /** siteId retained for future per-site action scoping */
  siteId: string;
}) {
  if (actions.length === 0) return null;

  const [hero, ...rest] = actions;

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100">Playbook</h2>
        <p className="text-[11px] text-stone-500 mt-0.5">
          {actions.length} action{actions.length !== 1 ? "s" : ""} to protect margin today
        </p>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Hero — highest priority action */}
        <HeroActionCard action={hero} />

        {/* Remaining secondary actions */}
        {rest.map((a) => (
          <SecondaryActionCard key={a.id} action={a} />
        ))}
      </div>
    </div>
  );
}
