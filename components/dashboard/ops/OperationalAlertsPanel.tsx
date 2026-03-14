"use client";

/**
 * OperationalAlertsPanel
 *
 * Linear-style flat list of active operational alerts.
 * Each row: severity badge · type label · message · timestamp · CTA button
 *
 * No colored card backgrounds — severity conveyed via left accent border,
 * badge colour, and text colour only.
 */

import { useState, useTransition } from "react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import type { OperationalAlert, OperationalAlertSeverity } from "@/types";

interface Props {
  initialAlerts: OperationalAlert[];
}

// ── Severity config ───────────────────────────────────────────────────────────

const SEVERITY: Record<
  OperationalAlertSeverity,
  { accent: string; badge: string; badgeText: string; label: string; pulse: boolean }
> = {
  critical: {
    accent:    "border-l-red-600",
    badge:     "bg-red-600 text-white",
    badgeText: "Critical",
    label:     "Critical",
    pulse:     true,
  },
  high: {
    accent:    "border-l-red-400",
    badge:     "bg-red-100 text-red-700 ring-1 ring-red-200",
    badgeText: "High",
    label:     "High",
    pulse:     true,
  },
  medium: {
    accent:    "border-l-amber-400",
    badge:     "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
    badgeText: "Medium",
    label:     "Medium",
    pulse:     false,
  },
  low: {
    accent:    "border-l-stone-300 dark:border-l-stone-600",
    badge:     "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 ring-1 ring-stone-200 dark:ring-stone-700",
    badgeText: "Low",
    label:     "Low",
    pulse:     false,
  },
};

// Map alert type → human-readable title + specific CTA text
const TYPE_CONFIG: Record<
  OperationalAlert["alert_type"],
  { title: string; cta: string; href: string }
> = {
  compliance_expired:          { title: "Certificate expired",        cta: "View compliance →",  href: "/dashboard/compliance" },
  compliance_due_soon:         { title: "Certificate due soon",       cta: "View compliance →",  href: "/dashboard/compliance" },
  maintenance_risk:            { title: "Maintenance risk",           cta: "Open ticket →",      href: "/dashboard/maintenance" },
  equipment_warranty_expiring: { title: "Warranty expiring",          cta: "Inspect issue →",    href: "/dashboard/maintenance" },
  equipment_service_due:       { title: "Service due",                cta: "Inspect issue →",    href: "/dashboard/maintenance" },
  equipment_overdue_attention: { title: "Equipment overdue",          cta: "Inspect issue →",    href: "/dashboard/maintenance" },
  revenue_risk:                { title: "Revenue risk",               cta: "Review targets →",   href: "/dashboard/settings/targets" },
  labor_cost_risk:             { title: "Labour cost elevated",       cta: "Review ops →",       href: "/dashboard/operations" },
  margin_risk:                 { title: "Margin risk",                cta: "Review ops →",       href: "/dashboard/operations" },
  reputation_risk:             { title: "Reputation risk",            cta: "Review items →",     href: "/dashboard/reviews" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperationalAlertsPanel({ initialAlerts }: Props) {
  const [alerts, setAlerts] = useState<OperationalAlert[]>(initialAlerts);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleResolve = (id: string) => {
    setResolvingId(id);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
        if (res.ok) {
          setAlerts((prev) => prev.filter((a) => a.id !== id));
        }
      } catch {
        // silent — keep alert visible if request fails
      } finally {
        setResolvingId(null);
      }
    });
  };

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const high     = alerts.filter((a) => a.severity === "high").length;

  if (alerts.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 dark:border-stone-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-stone-900 dark:text-stone-100">Active Alerts</h2>
          <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-px text-[10px] font-semibold text-stone-600 dark:text-stone-400 tabular-nums">
            {alerts.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {critical > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-px text-[10px] font-semibold text-white">
              <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
              {critical} critical
            </span>
          )}
          {high > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-px text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
              {high} high
            </span>
          )}
        </div>
      </div>

      {/* Alert rows */}
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {alerts.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            resolving={resolvingId === alert.id}
            onResolve={handleResolve}
          />
        ))}
      </div>
    </section>
  );
}

// ── AlertRow ──────────────────────────────────────────────────────────────────

function AlertRow({
  alert,
  resolving,
  onResolve,
}: {
  alert: OperationalAlert;
  resolving: boolean;
  onResolve: (id: string) => void;
}) {
  const cfg     = SEVERITY[alert.severity];
  const typeCfg = TYPE_CONFIG[alert.alert_type] ?? {
    title: alert.alert_type.replace(/_/g, " "),
    cta:   "View →",
    href:  "#",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-l-2 px-5 py-3.5 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors",
        cfg.accent
      )}
    >
      {/* Severity badge */}
      <span
        className={cn(
          "mt-px shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wider leading-none",
          cfg.badge
        )}
      >
        {cfg.label}
        {cfg.pulse && (
          <span className="ml-1 inline-block h-1 w-1 rounded-full bg-current align-middle opacity-80 animate-pulse" />
        )}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-800 dark:text-stone-200 leading-tight">
              {typeCfg.title}
              {alert.location && (
                <span className="font-normal text-stone-500"> · {alert.location}</span>
              )}
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500 leading-snug line-clamp-2">
              {alert.message}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0 mt-px">
            <a
              href={typeCfg.href}
              className="text-[11px] font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 whitespace-nowrap transition-colors"
            >
              {typeCfg.cta}
            </a>
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <button
              onClick={() => onResolve(alert.id)}
              disabled={resolving}
              className={cn(
                "text-[11px] font-medium whitespace-nowrap transition-colors",
                resolving
                  ? "text-stone-300 dark:text-stone-600 cursor-not-allowed"
                  : "text-stone-400 dark:text-stone-600 hover:text-stone-700 dark:hover:text-stone-300"
              )}
            >
              {resolving ? "Resolving…" : "Dismiss"}
            </button>
          </div>
        </div>

        {/* Timestamp */}
          <time className="mt-1 block text-[10px] text-stone-400 dark:text-stone-600" dateTime={alert.created_at}>
          {formatDistanceToNowStrict(parseISO(alert.created_at), { addSuffix: true })}
        </time>
      </div>
    </div>
  );
}
