"use client";

/**
 * OperationalAlertsPanel
 *
 * Client component — displays active operational alerts with severity colour
 * coding, recommendation text, timestamp, and an inline resolve button.
 *
 * Props:
 *   initialAlerts — pre-fetched on the server; hydrated immediately.
 *
 * UX:
 *   • Resolving an alert calls POST /api/alerts/[id]/resolve,
 *     then optimistically removes it from the local list.
 *   • Critical/high alerts render with a pulsing attention dot.
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
  { card: string; badge: string; dot: string; label: string; pulse: boolean }
> = {
  critical: {
    card:  "border-red-300 bg-red-50",
    badge: "bg-red-600 text-white",
    dot:   "bg-red-600",
    label: "CRITICAL",
    pulse: true,
  },
  high: {
    card:  "border-red-200 bg-red-50",
    badge: "bg-red-100 text-red-700 ring-1 ring-red-300",
    dot:   "bg-red-500",
    label: "HIGH",
    pulse: true,
  },
  medium: {
    card:  "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
    dot:   "bg-amber-500",
    label: "MEDIUM",
    pulse: false,
  },
  low: {
    card:  "border-stone-200 bg-stone-50",
    badge: "bg-stone-100 text-stone-600 ring-1 ring-stone-200",
    dot:   "bg-stone-400",
    label: "LOW",
    pulse: false,
  },
};

const TYPE_ICON: Record<OperationalAlert["alert_type"], string> = {
  revenue_risk:                "📉",
  labor_cost_risk:             "💰",
  margin_risk:                 "📊",
  maintenance_risk:            "🔧",
  reputation_risk:             "⭐",
  compliance_expired:          "📋",
  compliance_due_soon:         "📋",
  equipment_warranty_expiring: "🛡️",
  equipment_service_due:       "🔧",
  equipment_overdue_attention: "⚠️",
};

const TYPE_LABEL: Record<OperationalAlert["alert_type"], string> = {
  revenue_risk:                "Revenue Risk",
  labor_cost_risk:             "Labor Cost Risk",
  margin_risk:                 "Margin Risk",
  maintenance_risk:            "Maintenance Risk",
  reputation_risk:             "Reputation Risk",
  compliance_expired:          "Compliance Expired",
  compliance_due_soon:         "Compliance Due Soon",
  equipment_warranty_expiring: "Warranty Expiring",
  equipment_service_due:       "Service Due",
  equipment_overdue_attention: "Equipment Overdue",
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

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">🚦</span>
          <div>
            <h2 className="text-sm font-bold text-stone-900">
              Operational Alerts
            </h2>
            <p className="text-[10px] text-stone-400">
              Automated threshold monitoring
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {critical > 0 && (
            <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-bold text-white">
              {critical} CRITICAL
            </span>
          )}
          {high > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">
              {high} HIGH
            </span>
          )}
          {alerts.length === 0 && (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
              ✓ All clear
            </span>
          )}
        </div>
      </div>

      {/* Alerts list */}
      {alerts.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm font-medium text-green-700">
            ✓ No active operational alerts
          </p>
          <p className="mt-1 text-xs text-stone-400">
            All systems within normal thresholds.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-stone-100">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              resolving={resolvingId === alert.id}
              onResolve={handleResolve}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── AlertCard ─────────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  resolving,
  onResolve,
}: {
  alert: OperationalAlert;
  resolving: boolean;
  onResolve: (id: string) => void;
}) {
  const cfg = SEVERITY[alert.severity];

  return (
    <div className={cn("px-5 py-4", cfg.card)}>
      <div className="flex items-start gap-3">
        {/* Attention dot */}
        <div className="mt-1 flex-shrink-0">
          <span
            className={cn(
              "block h-2 w-2 rounded-full",
              cfg.dot,
              cfg.pulse && "animate-pulse"
            )}
          />
        </div>

        {/* Icon + content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm leading-none">
              {TYPE_ICON[alert.alert_type]}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wider uppercase",
                cfg.badge
              )}
            >
              {cfg.label}
            </span>
            <span className="text-xs font-semibold text-stone-700">
              {TYPE_LABEL[alert.alert_type]}
            </span>
            {alert.location && (
              <span className="text-[10px] text-stone-400">
                · {alert.location}
              </span>
            )}
          </div>

          {/* Message */}
          <p className="text-sm text-stone-800 leading-snug">{alert.message}</p>

          {/* Recommendation */}
          {alert.recommendation && (
            <div className="mt-2 flex items-start gap-1.5">
              <span className="text-[11px] font-semibold text-stone-500 shrink-0 mt-0.5">
                REC:
              </span>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                {alert.recommendation}
              </p>
            </div>
          )}

          {/* Footer: timestamp + resolve button */}
          <div className="mt-3 flex items-center justify-between gap-3">
            <time
              className="text-[10px] text-stone-400"
              dateTime={alert.created_at}
            >
              {formatDistanceToNowStrict(parseISO(alert.created_at), {
                addSuffix: true,
              })}
            </time>

            <button
              onClick={() => onResolve(alert.id)}
              disabled={resolving}
              className={cn(
                "rounded-md border px-3 py-1 text-xs font-semibold transition-colors",
                resolving
                  ? "border-stone-200 bg-stone-100 text-stone-400 cursor-not-allowed"
                  : "border-stone-300 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900"
              )}
            >
              {resolving ? "Resolving…" : "Mark resolved"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
