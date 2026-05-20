/**
 * MicrosAlertBanner — renders MICROS_* alert tiles above the site cards.
 */
"use client";

import React from "react";
import type { MicrosHealthAlert } from "@/lib/system-health/micros-health-types";

const SEVERITY_STYLES = {
  critical: "bg-red-950/60 border-red-700/50 text-red-300",
  warning:  "bg-amber-950/60 border-amber-700/50 text-amber-300",
  info:     "bg-blue-950/60 border-blue-700/50 text-blue-300",
} as const;

const TYPE_ICON: Record<string, string> = {
  MICROS_STALE:        "🕐",
  MICROS_FAILURE:      "❌",
  MICROS_NO_SALES:     "🚫",
  MICROS_EMPTY_LABOUR: "👷",
  MICROS_DISCONNECTED: "⚡",
};

interface Props {
  alerts: MicrosHealthAlert[];
}

export default function MicrosAlertBanner({ alerts }: Props) {
  if (!alerts.length) return null;

  const critical = alerts.filter((a) => a.severity === "critical");
  const warnings = alerts.filter((a) => a.severity === "warning");
  const display  = [...critical, ...warnings].slice(0, 6);

  return (
    <div className="flex flex-col gap-2">
      {display.map((alert, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 rounded-lg border px-4 py-2.5 text-sm ${SEVERITY_STYLES[alert.severity as keyof typeof SEVERITY_STYLES]}`}
        >
          <span className="text-base leading-tight">{TYPE_ICON[alert.type] ?? "⚠️"}</span>
          <div className="flex-1">
            <span className="font-semibold">{alert.siteName}</span>
            {" — "}
            {alert.message}
          </div>
          <span className="text-xs opacity-60 whitespace-nowrap">{alert.type}</span>
        </div>
      ))}
      {alerts.length > 6 && (
        <div className="text-xs text-slate-500 pl-2">+ {alerts.length - 6} more alerts</div>
      )}
    </div>
  );
}
