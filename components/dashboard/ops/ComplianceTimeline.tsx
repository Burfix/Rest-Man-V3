/**
 * ComplianceTimeline
 *
 * Sorted table of compliance items showing:
 * Status chip · Certificate name · Due date · Days remaining · Responsible party
 *
 * Sort order: expired first → due_soon → compliant → unknown
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import StatusChip from "@/components/ui/StatusChip";
import type { StatusVariant } from "@/components/ui/StatusChip";
import EmptyStateBlock from "@/components/ui/EmptyStateBlock";
import type { ComplianceSummary, ComplianceItem, ComplianceStatus } from "@/types";

interface Props {
  compliance: ComplianceSummary;
}

const STATUS_ORDER: Record<ComplianceStatus, number> = {
  expired:     0,
  due_soon:    1,
  in_progress: 2,
  scheduled:   3,
  compliant:   4,
  blocked:     5,
  unknown:     6,
};

const STATUS_CONFIG: Record<ComplianceStatus, {
  chip:    string;
  variant: StatusVariant;
  daysCls: string;
}> = {
  expired:     { chip: "Expired",     variant: "critical", daysCls: "text-red-600 font-bold" },
  due_soon:    { chip: "Due Soon",    variant: "warning",  daysCls: "text-amber-600 font-semibold" },
  in_progress: { chip: "In Progress", variant: "warning",  daysCls: "text-amber-600" },
  scheduled:   { chip: "Scheduled",   variant: "ok",       daysCls: "text-emerald-600" },
  compliant:   { chip: "Current",     variant: "ok",       daysCls: "text-emerald-600" },
  blocked:     { chip: "Blocked",     variant: "critical", daysCls: "text-red-600" },
  unknown:     { chip: "Unknown",     variant: "neutral",  daysCls: "text-stone-500 dark:text-stone-400" },
};

function daysLabel(item: ComplianceItem): string {
  if (!item.next_due_date) return "—";
  try {
    const due   = new Date(item.next_due_date + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (diff < 0)  return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "Due today";
    return `${diff}d`;
  } catch {
    return "—";
  }
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return d; }
}

// Combine and sort all known items
function sortedItems(compliance: ComplianceSummary): ComplianceItem[] {
  const seen = new Set<string>();
  const all: ComplianceItem[] = [];

  for (const item of [...compliance.critical_items, ...compliance.due_soon_items]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      all.push(item);
    }
  }

  return all.sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 3;
    const ob = STATUS_ORDER[b.status] ?? 3;
    if (oa !== ob) return oa - ob;
    // within same status, sort by date ascending
    const da = a.next_due_date ?? "9999";
    const db = b.next_due_date ?? "9999";
    return da.localeCompare(db);
  });
}

export default function ComplianceTimeline({ compliance }: Props) {
  const items = sortedItems(compliance);
  const totalIssues = compliance.expired + compliance.due_soon;

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-stone-50">
        <div className="flex items-center gap-2.5">
          <span className="text-sm">📅</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-stone-700">
            Compliance Tracker
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalIssues > 0 && (
            <StatusChip
              variant={compliance.expired > 0 ? "critical" : "warning"}
              size="xs"
              dot
            >
              {compliance.expired > 0
                ? `${compliance.expired} expired`
                : `${compliance.due_soon} due soon`}
            </StatusChip>
          )}
          <Link href="/dashboard/compliance" className="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-700">
            Manage all →
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-5">
          {compliance.total === 0 ? (
            <EmptyStateBlock
              compact
              icon="📋"
              title="No compliance items tracked"
              body="Add certificates and regulatory requirements to monitor expiry dates."
              cta={{ label: "Set up compliance", href: "/dashboard/compliance" }}
            />
          ) : (
            <div className="flex items-center gap-3 py-4 text-emerald-700">
              <span className="text-xl">✅</span>
              <div>
                <p className="text-sm font-semibold">All {compliance.total} item{compliance.total > 1 ? "s" : ""} are up-to-date</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">No expired or expiring certificates.</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Certificate</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 hidden sm:table-cell">Due Date</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Days</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400 hidden lg:table-cell">Responsible</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {items.map((item) => {
                  const cfg     = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.unknown;
                  const days    = daysLabel(item);
                  const isUrgent = item.status === "expired" || item.status === "due_soon";

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors hover:bg-stone-50",
                        item.status === "expired"  && "bg-red-50/30",
                        item.status === "due_soon" && "bg-amber-50/20"
                      )}
                    >
                      <td className="px-4 py-3">
                        <StatusChip variant={cfg.variant} size="xs" dot>
                          {cfg.chip}
                        </StatusChip>
                      </td>
                      <td className="px-4 py-3">
                        <p className={cn(
                          "font-semibold leading-snug",
                          isUrgent ? "text-stone-900" : "text-stone-600"
                        )}>
                          {item.display_name}
                        </p>
                        {item.description && (
                          <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">{item.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-500 hidden sm:table-cell whitespace-nowrap">
                        {fmtDate(item.next_due_date)}
                      </td>
                      <td className={cn("px-4 py-3 text-right whitespace-nowrap tabular-nums", cfg.daysCls)}>
                        {days}
                      </td>
                      <td className="px-4 py-3 text-stone-500 dark:text-stone-400 hidden lg:table-cell whitespace-nowrap">
                        {item.responsible_party ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href="/dashboard/compliance"
                          className={cn(
                            "inline-flex items-center rounded-md px-2.5 py-1 text-[10px] font-semibold border transition-colors",
                            item.status === "expired"
                              ? "border-red-300 text-red-700 hover:bg-red-50"
                              : item.status === "due_soon"
                              ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                              : "border-stone-200 text-stone-500 hover:bg-stone-50"
                          )}
                        >
                          {item.status === "expired" ? "Renew" : item.status === "due_soon" ? "Review" : "View"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Compliant summary row */}
          {compliance.compliant > 0 && (
            <div className="border-t border-stone-100 px-4 py-2.5 bg-stone-50 flex items-center justify-between">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                <span className="font-semibold text-emerald-600">{compliance.compliant}</span> certificate{compliance.compliant > 1 ? "s" : ""} fully up-to-date
              </p>
              <Link href="/dashboard/compliance" className="text-[11px] text-stone-500 dark:text-stone-400 hover:underline">
                View all {compliance.total} →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
