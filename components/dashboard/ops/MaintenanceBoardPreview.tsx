/**
 * MaintenanceBoardPreview — Kanban-style 4-column board
 *
 * Columns: Open · In Progress · Awaiting Parts · Recently Fixed
 * Populated from MaintenanceSummary.urgentIssues.
 * Shows count badges on column headers.
 */

import Link from "next/link";
import { cn, formatShortDate } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
import EmptyStateBlock from "@/components/ui/EmptyStateBlock";
import type { MaintenanceSummary, MaintenanceLog, RepairStatus, MaintenancePriority } from "@/types";

interface Props {
  maintenance: MaintenanceSummary;
}

// ── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: {
  id:      RepairStatus;
  label:   string;
  count:   keyof MaintenanceSummary;
  icon:    string;
  accent:  string;
  header:  string;
}[] = [
  { id: "open",           label: "Open",               count: "openRepairs",   icon: "🔴", accent: "border-red-200 bg-red-50/30",    header: "text-red-700"   },
  { id: "in_progress",    label: "In Progress",        count: "inProgress",    icon: "🟡", accent: "border-amber-200 bg-amber-50/30", header: "text-amber-700" },
  { id: "awaiting_parts", label: "Awaiting Parts",     count: "awaitingParts", icon: "🔵", accent: "border-blue-200 bg-blue-50/30",   header: "text-blue-700"  },
  { id: "resolved",       label: "Recently Fixed",     count: "openRepairs",   icon: "🟢", accent: "border-emerald-200",               header: "text-emerald-700" },
];

const PRIORITY_CHIP: Record<MaintenancePriority, { label: string; cls: string }> = {
  urgent: { label: "Urgent", cls: "bg-red-100 text-red-700"    },
  high:   { label: "High",   cls: "bg-orange-100 text-orange-700" },
  medium: { label: "Medium", cls: "bg-amber-100 text-amber-700" },
  low:    { label: "Low",    cls: "bg-stone-100 text-stone-500"  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaintenanceBoardPreview({ maintenance }: Props) {
  const { urgentIssues } = maintenance;

  const byStatus = (status: RepairStatus) =>
    urgentIssues.filter((i) => i.repair_status === status);

  const totalOpen = maintenance.openRepairs + maintenance.inProgress + maintenance.awaitingParts;

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-stone-50">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">🔧</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-700">
            Maintenance Board
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalOpen > 0 && (
            <StatusChip variant={maintenance.outOfService > 0 ? "critical" : "warning"} size="xs" dot>
              {totalOpen} open
            </StatusChip>
          )}
          <Link href="/dashboard/maintenance" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700">
            Full board →
          </Link>
        </div>
      </div>

      {maintenance.totalEquipment === 0 ? (
        <div className="p-5">
          <EmptyStateBlock
            compact
            icon="🔧"
            title="No equipment tracked"
            body="Add equipment assets to start tracking maintenance issues."
            cta={{ label: "Add equipment", href: "/dashboard/maintenance" }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-stone-100 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const issues = byStatus(col.id);
            const count  =
              col.id === "open"           ? maintenance.openRepairs   :
              col.id === "in_progress"    ? maintenance.inProgress    :
              col.id === "awaiting_parts" ? maintenance.awaitingParts :
              issues.length; // resolved — use what we have

            return (
              <div key={col.id} className="flex flex-col p-4 min-h-[200px]">
                {/* Column header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{col.icon}</span>
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", col.header)}>
                      {col.label}
                    </span>
                  </div>
                  <span className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-bold",
                    count > 0
                      ? col.id === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-600"
                      : "bg-stone-100 text-stone-500 dark:text-stone-400"
                  )}>
                    {count}
                  </span>
                </div>

                {/* Issue cards */}
                <div className="flex-1 space-y-2">
                  {issues.slice(0, 3).map((issue) => (
                    <IssueCard key={issue.id} issue={issue} />
                  ))}

                  {/* phantom count if server-side count > loaded issues */}
                  {col.id !== "resolved" && count > issues.length && issues.length === 0 && (
                    <div className={cn(
                      "rounded-lg border px-3 py-2 text-center",
                      col.accent
                    )}>
                      <p className="text-xs font-semibold text-stone-600">
                        {count} issue{count > 1 ? "s" : ""}
                      </p>
                      <Link href="/dashboard/maintenance" className="text-[10px] text-stone-500 dark:text-stone-400 hover:underline">
                        View in maintenance
                      </Link>
                    </div>
                  )}

                  {issues.length === 0 && count === 0 && col.id !== "resolved" && (
                    <p className="text-[11px] text-stone-600 dark:text-stone-300 italic text-center pt-4">None</p>
                  )}
                  {issues.length === 0 && col.id === "resolved" && (
                    <p className="text-[11px] text-stone-600 dark:text-stone-300 italic text-center pt-4">No recent repairs</p>
                  )}
                </div>

                {issues.length > 3 && (
                  <Link
                    href="/dashboard/maintenance"
                    className="mt-2 text-center text-[10px] text-stone-500 dark:text-stone-400 hover:text-stone-600 hover:underline"
                  >
                    +{issues.length - 3} more
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── IssueCard ──────────────────────────────────────────────────────────────────

function IssueCard({ issue }: { issue: MaintenanceLog }) {
  const pCfg = PRIORITY_CHIP[issue.priority] ?? PRIORITY_CHIP.medium;
  const ageMs = Date.now() - new Date(issue.date_reported + "T00:00:00").getTime();
  const ageDays = Math.round(ageMs / 86_400_000);

  return (
    <Link
      href={issue.equipment_id ? `/dashboard/maintenance/equipment/${issue.equipment_id}` : "/dashboard/maintenance"}
      className="block rounded-lg border border-stone-200 bg-white p-3 hover:border-stone-300 hover:shadow-sm transition-all"
    >
      <p className="text-xs font-semibold text-stone-900 leading-snug line-clamp-1">
        {issue.unit_name}
      </p>
      <p className="text-[10px] text-stone-500 mt-0.5 line-clamp-1">{issue.issue_title}</p>

      <div className="mt-2 flex items-center justify-between gap-1">
        <span className={cn("rounded-md px-1.5 py-px text-[9px] font-bold uppercase", pCfg.cls)}>
          {pCfg.label}
        </span>
        <span className="text-[10px] text-stone-500 dark:text-stone-400">{ageDays}d ago</span>
      </div>

      {issue.resolved_by && (
        <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400 truncate">
          ↳ {issue.resolved_by}
        </p>
      )}
    </Link>
  );
}
