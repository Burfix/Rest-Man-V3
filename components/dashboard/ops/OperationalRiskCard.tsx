/**
 * OperationalRiskCard — Combined compliance + maintenance risk view
 *
 * Gives the GM a single executive-level view of whether the restaurant
 * is operationally safe today. Left card of the risk/brief grid.
 *
 * Risk level: High (expired cert / out-of-service unit) · Moderate · Low
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ComplianceSummary, MaintenanceSummary } from "@/types";

interface Props {
  compliance:  ComplianceSummary;
  maintenance: MaintenanceSummary;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

export default function OperationalRiskCard({ compliance, maintenance }: Props) {
  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;

  // ── Overall risk level ───────────────────────────────────────────────────
  const riskLevel: "High" | "Moderate" | "Low" =
    compliance.expired > 0 || maintenance.outOfService > 0 ? "High"     :
    compliance.due_soon > 0 || totalOpen > 0               ? "Moderate" :
    "Low";

  const riskCfg = {
    High: {
      border: "border-red-200 dark:border-red-900",
      badge:  "bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800",
      dot:    "bg-red-500",
    },
    Moderate: {
      border: "border-amber-200 dark:border-amber-900",
      badge:  "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800",
      dot:    "bg-amber-500",
    },
    Low: {
      border: "border-stone-200 dark:border-stone-800",
      badge:  "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800",
      dot:    "bg-emerald-500",
    },
  };
  const cfg = riskCfg[riskLevel];

  // ── Summary sentence ─────────────────────────────────────────────────────
  const parts: string[] = [];
  if (compliance.expired > 0)
    parts.push(`${compliance.expired} certificate${compliance.expired > 1 ? "s" : ""} expired`);
  if (maintenance.outOfService > 0)
    parts.push(`${maintenance.outOfService} unit${maintenance.outOfService > 1 ? "s" : ""} out of service`);
  if (compliance.due_soon > 0)
    parts.push(`${compliance.due_soon} compliance item${compliance.due_soon > 1 ? "s" : ""} due soon`);
  if (totalOpen > 0)
    parts.push(`${totalOpen} open repair${totalOpen > 1 ? "s" : ""}`);

  const summary =
    parts.length > 0
      ? parts.join(" · ")
      : "No active compliance or maintenance risks detected.";

  // ── Next risk ────────────────────────────────────────────────────────────
  const nextItem = compliance.critical_items[0] ?? compliance.due_soon_items[0] ?? null;
  const nextDays = nextItem ? daysUntil(nextItem.next_due_date) : null;
  const nextLabel = nextItem
    ? `${nextItem.display_name}${nextItem.next_due_date ? ` — due ${nextItem.next_due_date}` : ""}`
    : null;
  const nextColor =
    (nextDays ?? 999) <= 0  ? "text-red-600 dark:text-red-400"   :
    (nextDays ?? 999) <= 7  ? "text-red-600 dark:text-red-400"   :
    (nextDays ?? 999) <= 30 ? "text-amber-600 dark:text-amber-400" :
    "text-stone-500 dark:text-stone-500";

  return (
    <div className={cn(
      "flex flex-col rounded-xl border bg-white dark:bg-stone-900 overflow-hidden",
      cfg.border
    )}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <h2 className="text-xs font-bold uppercase tracking-widest text-stone-700 dark:text-stone-300">
          Operational Risk
        </h2>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
          cfg.badge
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
          {riskLevel} Risk
        </span>
      </div>

      {/* Summary */}
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
          {summary}
        </p>
        {nextLabel && (
          <p className={cn("mt-2 text-xs font-medium", nextColor)}>
            Next risk: {nextLabel}
          </p>
        )}
      </div>

      {/* Compliance row */}
      <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-1.5">
              Compliance
            </p>
            {compliance.total === 0 ? (
              <p className="text-xs text-stone-500 dark:text-stone-600">
                No certificates tracked — add items to monitor expiry dates
              </p>
            ) : (
              <>
                <p className="text-xs text-stone-700 dark:text-stone-300">
                  <span className="font-bold text-stone-900 dark:text-stone-100">
                    {compliance.compliance_pct}%
                  </span>{" "}
                  compliant ·{" "}
                  <span className={compliance.compliant > 0 ? "text-emerald-600 dark:text-emerald-500" : "text-stone-500 dark:text-stone-400"}>
                    {compliance.compliant} current
                  </span>
                  {compliance.due_soon > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" · "}{compliance.due_soon} due soon
                    </span>
                  )}
                  {compliance.expired > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {" · "}{compliance.expired} expired
                    </span>
                  )}
                </p>
                {compliance.critical_items.length > 0 && (
                  <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                    Expired: {compliance.critical_items.slice(0, 2).map((i) => i.display_name).join(", ")}
                    {compliance.critical_items.length > 2 && ` +${compliance.critical_items.length - 2} more`}
                  </p>
                )}
                {compliance.due_soon_items.length > 0 && compliance.critical_items.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    Due: {compliance.due_soon_items.slice(0, 2).map((i) => i.display_name).join(", ")}
                  </p>
                )}
              </>
            )}
          </div>
          <Link
            href="/dashboard/compliance"
            className="shrink-0 text-[11px] font-medium text-stone-500 dark:text-stone-600 hover:text-stone-800 dark:hover:text-stone-200 transition-colors whitespace-nowrap"
          >
            Manage →
          </Link>
        </div>
      </div>

      {/* Maintenance row */}
      <div className="flex-1 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-600 mb-1.5">
              Maintenance
            </p>
            {maintenance.totalEquipment === 0 ? (
              <p className="text-xs text-stone-500 dark:text-stone-600">
                No equipment tracked — add units to monitor service status
              </p>
            ) : (
              <>
                <p className="text-xs text-stone-700 dark:text-stone-300">
                  <span className="font-bold text-stone-900 dark:text-stone-100">
                    {maintenance.totalEquipment}
                  </span>{" "}
                  units tracked
                  {totalOpen > 0 && (
                    <span className={cn(
                      maintenance.outOfService > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-amber-600 dark:text-amber-400"
                    )}>
                      {" · "}{totalOpen} open
                    </span>
                  )}
                  {maintenance.outOfService > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {" · "}{maintenance.outOfService} out of service
                    </span>
                  )}
                </p>
                {maintenance.urgentIssues.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    Urgent: {maintenance.urgentIssues[0].unit_name} — {maintenance.urgentIssues[0].issue_title}
                  </p>
                )}
              </>
            )}
          </div>
          <Link
            href="/dashboard/maintenance"
            className="shrink-0 text-[11px] font-medium text-stone-500 dark:text-stone-600 hover:text-stone-800 dark:hover:text-stone-200 transition-colors whitespace-nowrap"
          >
            Manage →
          </Link>
        </div>
      </div>

    </div>
  );
}
