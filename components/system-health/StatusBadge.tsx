"use client";

import { cn } from "@/lib/utils";
import type { DataSourceStatus, JobStatus, OverallStatus } from "@/lib/system-health/types";

type StatusVariant = OverallStatus | DataSourceStatus | JobStatus | "open" | "acknowledged" | "investigating" | "resolved" | "info" | "warning" | "critical";

interface StatusBadgeProps {
  status: StatusVariant;
  className?: string;
  dot?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; classes: string; dotColor: string }> = {
  // Overall
  healthy:        { label: "Healthy",        classes: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60", dotColor: "bg-emerald-500" },
  degraded:       { label: "Degraded",       classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",           dotColor: "bg-amber-500" },
  critical:       { label: "Critical",       classes: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60",                       dotColor: "bg-red-500" },
  // Data source
  live:           { label: "Live",           classes: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60", dotColor: "bg-emerald-500" },
  fresh:          { label: "Fresh",          classes: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-teal-200 dark:border-teal-800/60",                 dotColor: "bg-teal-400" },
  delayed:        { label: "Delayed",        classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",           dotColor: "bg-amber-400" },
  stale:          { label: "Stale",          classes: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400 border-orange-200 dark:border-orange-800/60",     dotColor: "bg-orange-500" },
  missing:        { label: "Missing",        classes: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60",                       dotColor: "bg-red-500" },
  not_configured: { label: "Not configured", classes: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",                   dotColor: "bg-zinc-400" },
  // Jobs
  success:        { label: "Success",        classes: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60", dotColor: "bg-emerald-500" },
  running:        { label: "Running",        classes: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800/60",                 dotColor: "bg-blue-400" },
  failed:         { label: "Failed",         classes: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60",                       dotColor: "bg-red-500" },
  idle:           { label: "Idle",           classes: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",                   dotColor: "bg-zinc-400" },
  disabled:       { label: "Disabled",       classes: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",                   dotColor: "bg-zinc-400" },
  // Incidents
  open:           { label: "Open",           classes: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800/60",                       dotColor: "bg-red-500" },
  acknowledged:   { label: "Acknowledged",   classes: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/60",     dotColor: "bg-indigo-500" },
  investigating:  { label: "Investigating",  classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",           dotColor: "bg-amber-500" },
  resolved:       { label: "Resolved",       classes: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",                   dotColor: "bg-zinc-400" },
  // Severity
  info:           { label: "Info",           classes: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-800/60",                 dotColor: "bg-blue-400" },
  warning:        { label: "Warning",        classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800/60",           dotColor: "bg-amber-400" },
};

export function StatusBadge({ status, className, dot = true }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.classes,
        className,
      )}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", config.dotColor)}
        />
      )}
      {config.label}
    </span>
  );
}
