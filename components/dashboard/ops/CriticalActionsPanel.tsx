/**
 * CriticalActionsPanel — Operations Control UI (Client Component)
 *
 * Every row surfaces:
 *   - Severity + impact tag (BLOCKER / HIGH RISK / etc.)
 *   - Problem statement (what's wrong)
 *   - Specific action (what to do)
 *   - Recovery metric (what outcome is needed)
 *   - Service-window countdown (how much time is left)
 *   - Three action buttons: Execute · Assign · Done
 *
 * Compliance actions support inline scheduling —
 * "Schedule Renewal" opens an inline form, saves via PUT API,
 * and optimistically updates the action card state.
 */

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import ImpactTag from "@/components/ui/ImpactTag";
import type { DashboardAction, ActionSeverity, ActionCategory } from "@/lib/commandCenter";

interface Props {
  actions: DashboardAction[];
}

const SEVERITY: Record<ActionSeverity, {
  accent:  string;
  badge:   string;
  label:   string;
  pulse:   boolean;
}> = {
  critical: {
    accent: "border-l-red-600",
    badge:  "bg-red-600 text-white",
    label:  "Critical",
    pulse:  true,
  },
  urgent: {
    accent: "border-l-amber-500",
    badge:  "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700",
    label:  "Urgent",
    pulse:  true,
  },
  action: {
    accent: "border-l-sky-400 dark:border-l-sky-600",
    badge:  "bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-800",
    label:  "Action",
    pulse:  false,
  },
  watch: {
    accent: "border-l-stone-300 dark:border-l-stone-600",
    badge:  "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 ring-1 ring-stone-200 dark:ring-stone-700",
    label:  "Watch",
    pulse:  false,
  },
};

const CATEGORY_ICON: Record<ActionCategory, string> = {
  compliance:  "📋",
  maintenance: "🔧",
  inventory:   "📦",
  revenue:     "📈",
  staffing:    "👥",
  events:      "🎭",
  data:        "📊",
};

// ── Countdown formatter ───────────────────────────────────────────────────────

function fmtCountdown(mins: number): string {
  if (mins <= 0)   return "Service closed";
  if (mins < 60)   return `${mins}m left in service`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m left in service` : `${h}h left in service`;
}

// ── Inline Scheduling Form ────────────────────────────────────────────────────

interface ScheduleFormProps {
  itemId: string;
  itemName: string;
  dueDate: string | null;
  onScheduled: (itemId: string, date: string, vendor: string | null) => void;
  onCancel: () => void;
}

function InlineScheduleForm({ itemId, itemName, dueDate, onScheduled, onCancel }: ScheduleFormProps) {
  const [date, setDate] = useState("");
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!date) { setError("Please select a renewal date"); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (date < today) { setError("Date cannot be in the past"); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_service_date: date,
          scheduled_with: vendor || null,
          schedule_note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Schedule failed");
      onScheduled(itemId, date, vendor || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule failed");
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/20 p-4 ml-[calc(1.875rem+0.625rem)]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">📅</span>
        <p className="text-xs font-bold text-stone-800 dark:text-stone-200">
          Schedule Renewal — {itemName}
        </p>
        {dueDate && (
          <span className="ml-auto text-[10px] text-stone-500 dark:text-stone-500">
            Expires {dueDate}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 dark:text-stone-400 mb-0.5 uppercase tracking-wide">
            Renewal Date *
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs text-stone-900 dark:text-stone-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 dark:text-stone-400 mb-0.5 uppercase tracking-wide">
            Vendor / Provider
          </label>
          <input
            type="text"
            placeholder="e.g. FireTech Solutions"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="w-full rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-stone-500 dark:text-stone-400 mb-0.5 uppercase tracking-wide">
            Note
          </label>
          <input
            type="text"
            placeholder="e.g. Deposit paid"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 px-2.5 py-1.5 text-xs text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save & Schedule"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-stone-300 dark:border-stone-700 px-3 py-1.5 text-[11px] font-semibold text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Success Toast ─────────────────────────────────────────────────────────────

function SuccessToast({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 ml-[calc(1.875rem+0.625rem)]">
      <span className="text-sm">✅</span>
      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">{message}</p>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CriticalActionsPanel({ actions: initialActions }: Props) {
  const [actions, setActions] = useState(initialActions);
  const [schedulingItem, setSchedulingItem] = useState<string | null>(null);
  const [successMessages, setSuccessMessages] = useState<Record<string, string>>({});

  const handleScheduled = useCallback((itemId: string, date: string, vendor: string | null) => {
    setSchedulingItem(null);

    // Show success message
    const itemName = actions
      .flatMap((a) => a.complianceItems ?? [])
      .find((i) => i.id === itemId)?.display_name ?? "Item";

    const fmtDate = new Date(date + "T00:00:00").toLocaleDateString("en-ZA", {
      day: "numeric", month: "short",
    });
    const msg = `Renewal scheduled for ${itemName} — ${fmtDate}${vendor ? ` (${vendor})` : ""}`;
    setSuccessMessages((prev) => ({ ...prev, [itemId]: msg }));

    // Optimistically update: remove the scheduled item from the action's complianceItems
    setActions((prev) => {
      const updated = prev.map((action) => {
        if (action.category !== "compliance" || !action.complianceItems) return action;

        const remaining = action.complianceItems.filter((i) => i.id !== itemId);
        if (remaining.length === 0) {
          // All items scheduled — convert to watch/success state
          return {
            ...action,
            severity: "watch" as ActionSeverity,
            title: "All upcoming compliance items are scheduled",
            message: "Upcoming compliance renewals are booked before expiry. No action required.",
            recommendation: "Confirm booked services are completed on schedule.",
            primaryAction: { label: "View schedule", href: "/dashboard/compliance" },
            complianceItems: [],
          };
        }

        // Update count and message with remaining items
        const nearest = remaining[0];
        const count = remaining.length;
        return {
          ...action,
          title: `${count} compliance item${count > 1 ? "s" : ""} due soon — not yet booked`,
          message: `${nearest.display_name} expires${nearest.next_due_date ? ` on ${nearest.next_due_date}` : " shortly"} — no renewal scheduled.`,
          complianceItems: remaining,
        };
      });
      return updated;
    });

    // Clear success message after 5s
    setTimeout(() => {
      setSuccessMessages((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }, 5000);
  }, [actions]);

  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-4">
        <span className="text-xl shrink-0" aria-hidden>✅</span>
        <div>
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            No action required right now
          </p>
          <p className="text-xs text-emerald-600 dark:text-emerald-600 mt-0.5">
            All operational areas are in order. Stay sharp — issues can emerge at any time.
          </p>
        </div>
      </div>
    );
  }

  const criticalCount  = actions.filter((a) => a.severity === "critical").length;
  const urgentCount    = actions.filter((a) => a.severity === "urgent").length;
  const highRiskActions = actions.filter((a) => a.isHighRisk);

  return (
    <section className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 overflow-hidden">

      {/* ── HIGH RISK banner ── shown when any action is flagged as high risk */}
      {highRiskActions.length > 0 && (
        <div className="flex items-center gap-3 border-b border-red-200 dark:border-red-900 bg-red-600 px-5 py-2.5">
          <span className="h-2 w-2 rounded-full bg-white animate-ping shrink-0" />
          <p className="text-xs font-bold text-white uppercase tracking-widest">
            HIGH RISK — Immediate action required
          </p>
          <span className="ml-auto text-[10px] font-semibold text-red-100">
            {highRiskActions.length} high-risk item{highRiskActions.length > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 dark:border-stone-800 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
            Priority Actions
          </h2>
          <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-px text-[10px] font-bold text-stone-600 dark:text-stone-400 tabular-nums">
            {actions.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {criticalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-px text-[10px] font-bold text-white">
              <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
              {criticalCount} critical
            </span>
          )}
          {urgentCount > 0 && (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-px text-[10px] font-bold text-amber-800 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-700">
              {urgentCount} urgent
            </span>
          )}
        </div>
      </div>

      {/* Action rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {actions.slice(0, 7).map((action, idx) => {
          const cfg  = SEVERITY[action.severity];
          const icon = CATEGORY_ICON[action.category] ?? "⚠️";
          const hasComplianceItems = action.category === "compliance"
            && (action.complianceItems?.length ?? 0) > 0
            && (action.severity === "urgent" || action.severity === "critical");

          return (
            <div
              key={idx}
              className={cn(
                "border-l-[3px] px-5 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors",
                cfg.accent,
                action.isHighRisk && "bg-red-50/40 dark:bg-red-950/10"
              )}
            >
              {/* Row 1 — impact tag + severity badge + title */}
              <div className="flex items-start gap-2.5 mb-2">
                <span className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider leading-none whitespace-nowrap",
                  cfg.badge
                )}>
                  {action.isHighRisk ? "HIGH RISK" : cfg.label}
                  {cfg.pulse && (
                    <span className="ml-1 inline-block h-1 w-1 rounded-full bg-current align-middle opacity-80 animate-pulse" />
                  )}
                </span>

                <span className="text-sm shrink-0 mt-px leading-none select-none" aria-hidden>
                  {icon}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-stone-900 dark:text-stone-100 leading-snug">
                    {action.title}
                    {action.impactWeight && (
                      <ImpactTag weight={action.impactWeight} className="ml-1.5 align-middle" />
                    )}
                  </p>
                </div>

                {/* Service window countdown */}
                {action.serviceWindowMinutes != null && action.serviceWindowMinutes > 0 && (
                  <span className="shrink-0 text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                    ⏱ {fmtCountdown(action.serviceWindowMinutes)}
                  </span>
                )}
              </div>

              {/* Row 2 — problem statement */}
              <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-snug mb-1.5 pl-[calc(1.875rem+0.625rem)]">
                <span className="font-semibold text-stone-700 dark:text-stone-300">Problem: </span>
                {action.message}
              </p>

              {/* Row 3 — specific action */}
              {action.recommendation && (
                <p className="text-[11px] text-stone-500 dark:text-stone-500 leading-snug mb-1.5 pl-[calc(1.875rem+0.625rem)]">
                  <span className="font-semibold text-stone-600 dark:text-stone-400">Action: </span>
                  {action.recommendation}
                </p>
              )}

              {/* Row 4 — recovery metric */}
              {action.recoveryMetric && (
                <p className={cn(
                  "text-[11px] font-semibold leading-snug mb-2.5 pl-[calc(1.875rem+0.625rem)]",
                  action.isHighRisk
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-700 dark:text-amber-400"
                )}>
                  📍 {action.recoveryMetric}
                </p>
              )}

              {/* Row 5 — action buttons */}
              <div className="flex items-center gap-2 pl-[calc(1.875rem+0.625rem)] flex-wrap">
                {/* Primary CTA — for compliance with items, show Schedule Renewal as button */}
                {hasComplianceItems ? (
                  <button
                    onClick={() => setSchedulingItem(
                      schedulingItem ? null : action.complianceItems![0].id
                    )}
                    className={cn(
                      "rounded px-2.5 py-1.5 text-[11px] font-bold leading-none whitespace-nowrap transition-colors",
                      schedulingItem
                        ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    )}
                  >
                    📅 Schedule Renewal
                  </button>
                ) : (
                  <Link
                    href={action.primaryAction?.href ?? action.href}
                    className={cn(
                      "rounded px-2.5 py-1.5 text-[11px] font-bold leading-none whitespace-nowrap transition-colors",
                      action.severity === "critical" || action.isHighRisk
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : action.severity === "urgent"
                        ? "bg-amber-500 text-white hover:bg-amber-600"
                        : "bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-white"
                    )}
                  >
                    {action.primaryAction?.label ?? "Execute →"}
                  </Link>
                )}

                {/* View in Compliance Hub */}
                {hasComplianceItems && (
                  <Link
                    href="/dashboard/compliance"
                    className="rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors ring-1 ring-stone-200 dark:ring-stone-700"
                  >
                    View Item
                  </Link>
                )}

                {/* Assign */}
                {!hasComplianceItems && (
                  <Link
                    href="/dashboard/actions"
                    className="rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors ring-1 ring-stone-200 dark:ring-stone-700"
                  >
                    Assign
                  </Link>
                )}

                {/* Done */}
                <Link
                  href="/dashboard/actions"
                  className="rounded px-2.5 py-1.5 text-[11px] font-semibold leading-none whitespace-nowrap text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors ring-1 ring-emerald-200 dark:ring-emerald-800"
                >
                  ✓ Done
                </Link>
              </div>

              {/* ── Inline scheduling forms for each compliance item ── */}
              {hasComplianceItems && schedulingItem && (
                <div className="space-y-2">
                  {action.complianceItems!
                    .filter((item) => item.id === schedulingItem)
                    .map((item) => (
                      <InlineScheduleForm
                        key={item.id}
                        itemId={item.id}
                        itemName={item.display_name}
                        dueDate={item.next_due_date}
                        onScheduled={handleScheduled}
                        onCancel={() => setSchedulingItem(null)}
                      />
                    ))}

                  {/* Quick schedule buttons for other items if multiple */}
                  {action.complianceItems!.length > 1 && (
                    <div className="ml-[calc(1.875rem+0.625rem)] flex flex-wrap gap-1.5 mt-2">
                      {action.complianceItems!
                        .filter((item) => item.id !== schedulingItem)
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setSchedulingItem(item.id)}
                            className="rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-stone-800 px-2.5 py-1 text-[10px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                          >
                            📅 {item.display_name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Success messages ── */}
              {action.complianceItems?.map((item) =>
                successMessages[item.id] ? (
                  <SuccessToast key={`success-${item.id}`} message={successMessages[item.id]} />
                ) : null
              )}
            </div>
          );
        })}
      </div>

    </section>
  );
}
