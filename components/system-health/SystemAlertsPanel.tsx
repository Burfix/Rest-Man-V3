"use client";

/**
 * components/system-health/SystemAlertsPanel.tsx
 *
 * Renders unresolved platform-level alerts from the system_alerts table.
 * Shown above SystemHealthOverview — only renders when alerts exist.
 *
 * Each alert has a Dismiss button that calls DELETE /api/system-health/alerts/[id]/resolve
 * and removes it from the UI optimistically.
 */

import { useState, useTransition } from "react";
import type { SystemAlert } from "@/lib/system-health/types";

interface Props {
  alerts: SystemAlert[];
}

// ── Severity config ────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  critical: {
    border:  "border-red-500",
    bg:      "bg-red-50 dark:bg-red-950/40",
    icon:    "text-red-500",
    badge:   "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
    dot:     "bg-red-500",
    label:   "Critical",
    pulse:   true,
  },
  warning: {
    border:  "border-amber-500",
    bg:      "bg-amber-50 dark:bg-amber-950/40",
    icon:    "text-amber-500",
    badge:   "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
    dot:     "bg-amber-500",
    label:   "Warning",
    pulse:   false,
  },
  info: {
    border:  "border-blue-500",
    bg:      "bg-blue-50 dark:bg-blue-950/40",
    icon:    "text-blue-500",
    badge:   "bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300",
    dot:     "bg-blue-500",
    label:   "Info",
    pulse:   false,
  },
} as const;

function formatAgo(isoTs: string): string {
  const mins = Math.round((Date.now() - new Date(isoTs).getTime()) / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Alert row ─────────────────────────────────────────────────────────────────

function AlertRow({
  alert,
  onDismiss,
}: {
  alert: SystemAlert;
  onDismiss: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const cfg = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;

  function handleDismiss() {
    startTransition(async () => {
      try {
        await fetch(`/api/system-health/alerts/${alert.id}/resolve`, { method: "DELETE" });
        onDismiss(alert.id);
      } catch {
        // Silently fail — alert stays visible
      }
    });
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border-l-4 px-4 py-3 ${cfg.border} ${cfg.bg}`}
    >
      {/* Severity dot */}
      <span className="mt-1 flex-shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          {cfg.pulse && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${cfg.dot}`}
            />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
        </span>
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.badge}`}>
            {cfg.label}
          </span>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {alert.title}
          </p>
          <span className="text-xs text-zinc-400">{formatAgo(alert.createdAt)}</span>
        </div>
        {alert.message && (
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {alert.message}
          </p>
        )}
        {/* Context details for worker alerts */}
        {alert.context && alert.alertType === "worker_silent" && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Last tick:{" "}
            {alert.context.last_tick_at
              ? formatAgo(String(alert.context.last_tick_at))
              : "never"}
            {" · "}
            Silent for {String(alert.context.minutes_silent ?? "?")} min
          </p>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        disabled={isPending}
        className="flex-shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        aria-label="Dismiss alert"
        title="Dismiss alert"
      >
        {isPending ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function SystemAlertsPanel({ alerts }: Props) {
  const [visible, setVisible] = useState<SystemAlert[]>(alerts);

  function dismiss(id: string) {
    setVisible(prev => prev.filter(a => a.id !== id));
  }

  if (visible.length === 0) return null;

  const hasCritical = visible.some(a => a.severity === "critical");

  return (
    <section aria-label="System alerts" className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          className={`h-4 w-4 ${hasCritical ? "text-red-500" : "text-amber-500"}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          System Alerts
        </span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
          hasCritical
            ? "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300"
        }`}>
          {visible.length} open
        </span>
      </div>

      {/* Alert rows — critical first */}
      {[...visible]
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
        })
        .map(alert => (
          <AlertRow key={alert.id} alert={alert} onDismiss={dismiss} />
        ))}
    </section>
  );
}
