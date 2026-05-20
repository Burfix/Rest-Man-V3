import { MaintenanceSummary, MaintenanceLog } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";

interface Props {
  summary: MaintenanceSummary;
}

const priorityConfig = {
  urgent: { badge: "bg-red-100 text-red-700", label: "Urgent" },
  high: { badge: "bg-orange-100 text-orange-700", label: "High" },
  medium: { badge: "bg-amber-100 text-amber-700", label: "Medium" },
  low: { badge: "bg-stone-100 text-stone-600", label: "Low" },
} as const;

const statusConfig = {
  open: { badge: "bg-red-50 text-red-600 ring-red-200", label: "Open" },
  in_progress: { badge: "bg-blue-50 text-blue-600 ring-blue-200", label: "In Progress" },
  awaiting_parts: { badge: "bg-amber-50 text-amber-600 ring-amber-200", label: "Awaiting Parts" },
  resolved: { badge: "bg-green-50 text-green-600 ring-green-200", label: "Resolved" },
  closed: { badge: "bg-stone-100 text-stone-500 ring-stone-200", label: "Closed" },
} as const;

export default function MaintenanceSection({ summary }: Props) {
  const totalOpen = summary.openRepairs + summary.inProgress + summary.awaitingParts;

  // Food safety: always trumps everything else visually
  const hasFoodSafety = (summary.foodSafetyRisks ?? 0) > 0;

  // Risk level banner
  const riskBanner = hasFoodSafety
    ? {
        bg: "bg-red-50 border border-red-200",
        text: "text-red-700",
        icon: "⚠️",
        message: `Food safety risk — ${summary.foodSafetyRisks} unresolved issue${summary.foodSafetyRisks !== 1 ? "s" : ""}. Requires immediate action.`,
      }
    : summary.outOfService > 0
    ? {
        bg: "bg-red-50 border border-red-200",
        text: "text-red-700",
        icon: "🔴",
        message:
          summary.outOfService === 1
            ? `1 unit out of service${summary.openRepairs > 0 ? ` · ${summary.openRepairs} open repair${summary.openRepairs > 1 ? "s" : ""}` : ""}.`
            : `${summary.outOfService} units out of service${summary.openRepairs > 0 ? ` · ${summary.openRepairs} open repair${summary.openRepairs > 1 ? "s" : ""}` : ""}.`,
      }
    : summary.openRepairs > 0
    ? {
        bg: "bg-amber-50 border border-amber-200",
        text: "text-amber-700",
        icon: "🟡",
        message: `${totalOpen} open issue${totalOpen > 1 ? "s" : ""} — no units currently out of service.`,
      }
    : summary.totalEquipment > 0
    ? {
        bg: "bg-emerald-50 border border-emerald-200",
        text: "text-emerald-700",
        icon: "🟢",
        message: "All equipment operational — no open issues.",
      }
    : null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">Maintenance Risk</h2>
        <a
          href="/dashboard/maintenance"
          className="text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700"
        >
          Full log →
        </a>
      </div>

      {/* Risk level banner */}
      {riskBanner && (
        <div className={cn("mb-4 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold", riskBanner.bg, riskBanner.text)}>
          <span>{riskBanner.icon}</span>
          <span>{riskBanner.message}</span>
        </div>
      )}

      {/* Stat row */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MiniStat label="Total Units" value={summary.totalEquipment} />
        <MiniStat
          label="Open"
          value={summary.openRepairs}
          highlight={summary.openRepairs > 0 ? "red" : undefined}
        />
        <MiniStat label="In Progress" value={summary.inProgress} highlight={summary.inProgress > 0 ? "amber" : undefined} />
        <MiniStat label="Awaiting Parts" value={summary.awaitingParts} highlight={summary.awaitingParts > 0 ? "amber" : undefined} />
        <MiniStat
          label="Out of Service"
          value={summary.outOfService}
          highlight={summary.outOfService > 0 ? "red" : undefined}
        />
      </div>

      {/* Intelligence stats row */}
      {(summary.resolvedThisWeek > 0 || summary.avgFixTimeDays != null || summary.monthlyActualCost != null || summary.topProblemAsset) && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-stone-100 bg-stone-50 px-4 py-2.5 text-xs text-stone-500">
          {summary.resolvedThisWeek > 0 && (
            <span>Resolved this week: <span className="font-semibold text-green-700">{summary.resolvedThisWeek}</span></span>
          )}
          {summary.avgFixTimeDays != null && (
            <span>Avg fix time: <span className="font-semibold text-stone-700">{summary.avgFixTimeDays.toFixed(1)} days</span></span>
          )}
          {summary.monthlyActualCost != null && summary.monthlyActualCost > 0 && (
            <span>Monthly cost: <span className="font-semibold text-stone-700">R {summary.monthlyActualCost.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span></span>
          )}
          {summary.topProblemAsset && (
            <span>Top issue: <span className="font-semibold text-amber-700">{summary.topProblemAsset}</span></span>
          )}
        </div>
      )}

      {summary.totalEquipment === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
          <p className="text-sm font-medium text-stone-500">
            No equipment registered yet
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Add your kitchen and bar equipment to start tracking maintenance.
          </p>
          <a
            href="/dashboard/maintenance"
            className="mt-3 inline-block rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700"
          >
            Add Equipment
          </a>
        </div>
      ) : totalOpen === 0 && summary.outOfService === 0 ? (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-700">
          ✓ No open maintenance issues.
        </p>
      ) : (
        <>
          {summary.urgentIssues.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                Urgent / High Priority
              </p>
              {/* Mobile: card list */}
              <div className="space-y-2 sm:hidden">
                {summary.urgentIssues.map((log) => (
                  <IssueCard key={log.id} log={log} />
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto rounded-lg border border-stone-200">
                <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
                  <thead>
                    <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                      <th className="px-4 py-2">Unit</th>
                      <th className="px-4 py-2">Issue</th>
                      <th className="px-4 py-2">Priority</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Reported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {summary.urgentIssues.map((log) => (
                      <IssueRow key={log.id} log={log} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function IssueCard({ log }: { log: MaintenanceLog }) {
  const pri = priorityConfig[log.priority] ?? priorityConfig.medium;
  const sts =
    statusConfig[log.repair_status as keyof typeof statusConfig] ??
    statusConfig.open;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-stone-800">{log.unit_name}</p>
          <p className="text-xs capitalize text-stone-500 dark:text-stone-400">{log.category}</p>
        </div>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", pri.badge)}>
          {pri.label}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-stone-700">{log.issue_title}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", sts.badge)}>
          {sts.label}
        </span>
        <span className="text-xs text-stone-500 dark:text-stone-400">{formatShortDate(log.date_reported)}</span>
      </div>
    </div>
  );
}

function IssueRow({ log }: { log: MaintenanceLog }) {
  const pri = priorityConfig[log.priority] ?? priorityConfig.medium;
  const sts =
    statusConfig[log.repair_status as keyof typeof statusConfig] ??
    statusConfig.open;

  return (
    <tr className="hover:bg-stone-50">
      <td className="whitespace-nowrap px-4 py-2.5">
        <p className="font-medium text-stone-800">{log.unit_name}</p>
        <p className="text-xs capitalize text-stone-500 dark:text-stone-400">{log.category}</p>
      </td>
      <td className="px-4 py-2.5 max-w-[220px]">
        <p className="truncate font-medium text-stone-700">{log.issue_title}</p>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-semibold",
            pri.badge
          )}
        >
          {pri.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            sts.badge
          )}
        >
          {sts.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-stone-500 dark:text-stone-400">
        {formatShortDate(log.date_reported)}
      </td>
    </tr>
  );
}

function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "red" | "amber";
}) {
  const colorMap = {
    red: "border-red-200 bg-red-50",
    amber: "border-amber-200 bg-amber-50",
  };
  const textMap = {
    red: "text-red-700",
    amber: "text-amber-700",
  };

  const isHighlighted = highlight && value > 0;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3",
        isHighlighted ? colorMap[highlight] : "border-stone-200 bg-white"
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-2xl font-bold",
          isHighlighted ? textMap[highlight] : "text-stone-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}
