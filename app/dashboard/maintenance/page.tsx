/**
 * Maintenance page — full equipment and repair log.
 */

import {
  getAllEquipment,
  getAllMaintenanceLogs,
  getUpcomingServices,
  getExpiringWarranties,
  getMaintenanceRiskScore,
  type UpcomingService,
  type ExpiringWarranty,
  type MaintenanceRiskScore,
} from "@/services/ops/maintenanceSummary";
import { Equipment, MaintenanceLog } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";
import {
  calcMTTR,
  getTopFailingAssets,
  getContractorPerformance,
  getBusinessImpactSummary,
  detectRepeatAssets,
} from "@/lib/maintenance-utils";
import MaintenanceActions from "@/components/dashboard/maintenance/MaintenanceActions";
import EditStatusButton from "@/components/dashboard/maintenance/EditStatusButton";
import Link from "next/link";
import { getUserContext } from "@/lib/auth/get-user-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const statusConfig = {
  operational: {
    badge: "bg-green-50 text-green-700 ring-green-200",
    label: "Operational",
  },
  needs_attention: {
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    label: "Needs Attention",
  },
  out_of_service: {
    badge: "bg-red-50 text-red-700 ring-red-200",
    label: "Out of Service",
  },
} as const;

const repairStatusConfig = {
  open: { badge: "bg-red-50 text-red-600 ring-red-200", label: "Open" },
  in_progress: {
    badge: "bg-blue-50 text-blue-600 ring-blue-200",
    label: "In Progress",
  },
  awaiting_parts: {
    badge: "bg-amber-50 text-amber-600 ring-amber-200",
    label: "Awaiting Parts",
  },
  resolved: {
    badge: "bg-green-50 text-green-600 ring-green-200",
    label: "Resolved",
  },
  closed: {
    badge: "bg-stone-100 text-stone-500 ring-stone-200",
    label: "Closed",
  },
} as const;

const priorityBadge = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-stone-100 text-stone-500",
} as const;

export default async function MaintenancePage() {
  let equipment: Equipment[] = [];
  let logs: MaintenanceLog[] = [];
  let upcomingServices: UpcomingService[] = [];
  let expiringWarranties: ExpiringWarranty[] = [];
  let riskScore: MaintenanceRiskScore | null = null;
  let loadError: string | null = null;

  let siteId: string | undefined;
  try {
    const ctx = await getUserContext();
    siteId = ctx.siteId;
  } catch {
    // fall through — page will show data without site filter
  }

  try {
    [equipment, logs, upcomingServices, expiringWarranties, riskScore] = await Promise.all([
      getAllEquipment(),
      getAllMaintenanceLogs({ limit: 100, siteId }),
      getUpcomingServices(30),
      getExpiringWarranties(60),
      getMaintenanceRiskScore(),
    ]);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Failed to load maintenance data.";
  }

  const byStatus = {
    operational: equipment.filter((e) => e.status === "operational").length,
    needs_attention: equipment.filter((e) => e.status === "needs_attention").length,
    out_of_service: equipment.filter((e) => e.status === "out_of_service").length,
  };

  const openLogs = logs.filter((l) =>
    ["open", "in_progress", "awaiting_parts"].includes(l.repair_status)
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Maintenance</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Equipment status and repair tracking
        </p>
      </div>

      {/* Action buttons — add equipment / log issue / resolve issue */}
      <MaintenanceActions equipment={equipment} openLogs={openLogs} />

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {/* Equipment status summary */}
      {equipment.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Total Units" value={equipment.length} />
          <SummaryCard
            label="Operational"
            value={byStatus.operational}
            color="green"
          />
          <SummaryCard
            label="Needs Attention"
            value={byStatus.needs_attention}
            color={byStatus.needs_attention > 0 ? "amber" : "stone"}
          />
          <SummaryCard
            label="Out of Service"
            value={byStatus.out_of_service}
            color={byStatus.out_of_service > 0 ? "red" : "stone"}
          />
        </div>
      )}

      {/* Maintenance Risk Score */}
      {riskScore && riskScore.total > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                Maintenance Risk Score
              </p>
              <p
                className={cn(
                  "mt-1 text-3xl font-bold",
                  riskScore.risk_pct >= 40
                    ? "text-red-600"
                    : riskScore.risk_pct >= 20
                    ? "text-amber-600"
                    : "text-green-600"
                )}
              >
                {riskScore.risk_pct.toFixed(0)}%
              </p>
              <p className="mt-0.5 text-xs text-stone-400">
                {riskScore.needs_attention} needing attention ·{" "}
                {riskScore.out_of_service} out of service
              </p>
            </div>
            <div className="text-right text-sm text-stone-500">
              <p>
                <span className="font-semibold text-green-600">{riskScore.operational}</span> operational
              </p>
              <p className="mt-0.5 text-xs text-stone-400">of {riskScore.total} total units</p>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-100">
            <div
              className={cn(
                "h-2 rounded-full transition-all",
                riskScore.risk_pct >= 40
                  ? "bg-red-500"
                  : riskScore.risk_pct >= 20
                  ? "bg-amber-400"
                  : "bg-green-500"
              )}
              style={{ width: `${Math.min(riskScore.risk_pct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Upcoming Services & Expiring Warranties */}
      {(upcomingServices.length > 0 || expiringWarranties.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Upcoming service due */}
          {upcomingServices.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
              <h2 className="mb-3 text-sm font-semibold text-amber-800">
                🔧 Service Due Within 30 Days
              </h2>
              <ul className="space-y-2">
                {upcomingServices.map((svc) => (
                  <li key={svc.equipment_id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/dashboard/maintenance/equipment/${svc.equipment_id}`}
                      className="font-medium text-amber-900 hover:underline"
                    >
                      {svc.unit_name}
                    </Link>
                    <span className="text-xs text-amber-700">
                      {formatShortDate(svc.next_service_due)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Expiring warranties */}
          {expiringWarranties.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
              <h2 className="mb-3 text-sm font-semibold text-blue-800">
                🛡️ Warranties Expiring Within 60 Days
              </h2>
              <ul className="space-y-2">
                {expiringWarranties.map((w) => (
                  <li key={w.equipment_id} className="flex items-center justify-between text-sm">
                    <Link
                      href={`/dashboard/maintenance/equipment/${w.equipment_id}`}
                      className="font-medium text-blue-900 hover:underline"
                    >
                      {w.unit_name}
                    </Link>
                    <span className={cn("text-xs", w.expired ? "text-red-600 font-semibold" : "text-blue-700")}>
                      {w.expired
                        ? "Expired"
                        : `${w.days_until_expiry}d left`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Maintenance Intelligence Panel */}
      {logs.length > 0 && (() => {
        const mttr       = calcMTTR(logs);
        const topAssets  = getTopFailingAssets(logs, 90).slice(0, 5);
        const contractors = getContractorPerformance(logs);
        const impact     = getBusinessImpactSummary(logs);
        const repeats    = detectRepeatAssets(logs, 45, 2);
        const hasData    = mttr != null || topAssets.length > 0 || contractors.length > 0 || repeats.length > 0;
        if (!hasData) return null;
        return (
          <div className="rounded-lg border border-stone-200 bg-white px-5 py-5 space-y-4">
            <h2 className="text-sm font-semibold text-stone-900">Maintenance Intelligence</h2>

            {/* KPI row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {mttr != null && (
                <div className="rounded-md border border-stone-100 bg-stone-50 px-3 py-2.5">
                  <p className="text-xs text-stone-400">Avg Fix Time (MTTR)</p>
                  <p className="mt-0.5 text-xl font-bold text-stone-800">{mttr.toFixed(1)}<span className="ml-1 text-xs font-normal text-stone-400">days</span></p>
                </div>
              )}
              {impact.foodSafetyRisks > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                  <p className="text-xs text-red-500">Food Safety Risks</p>
                  <p className="mt-0.5 text-xl font-bold text-red-700">{impact.foodSafetyRisks}</p>
                </div>
              )}
              {impact.serviceDisruptions > 0 && (
                <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2.5">
                  <p className="text-xs text-orange-500">Service Disruptions</p>
                  <p className="mt-0.5 text-xl font-bold text-orange-700">{impact.serviceDisruptions}</p>
                </div>
              )}
              {impact.complianceRisks > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs text-amber-600">Compliance Risks</p>
                  <p className="mt-0.5 text-xl font-bold text-amber-700">{impact.complianceRisks}</p>
                </div>
              )}
            </div>

            {/* Repeat issues alert */}
            {repeats.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5">
                <p className="text-xs font-semibold text-amber-800">⚠ Recurring issues (last 45 days)</p>
                <p className="mt-1 text-sm text-amber-700">{repeats.join(", ")} — consider preventive maintenance or replacement.</p>
              </div>
            )}

            {/* Top failing assets */}
            {topAssets.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Top Failing Assets (90 days)</p>
                <div className="space-y-1">
                  {topAssets.map((a) => (
                    <div key={a.asset_name} className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm">
                      <span className="font-medium text-stone-700">{a.asset_name}</span>
                      <span className={cn("text-xs font-semibold", a.hasOpenIssue ? "text-red-600" : "text-stone-400")}>
                        {a.count} issue{a.count > 1 ? "s" : ""}{a.hasOpenIssue ? " · open" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contractor performance */}
            {contractors.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Contractor Performance</p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium text-stone-400">
                        <th className="pb-1 pr-4">Contractor</th>
                        <th className="pb-1 pr-4">Issues</th>
                        <th className="pb-1 pr-4">Avg Fix</th>
                        <th className="pb-1">Avg Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {contractors.map((c) => (
                        <tr key={c.name}>
                          <td className="py-1.5 pr-4 font-medium text-stone-700">{c.name}</td>
                          <td className="py-1.5 pr-4 text-stone-500">{c.issuesHandled}</td>
                          <td className="py-1.5 pr-4 text-stone-500">{c.avgFixTimeDays != null ? `${c.avgFixTimeDays.toFixed(1)}d` : "—"}</td>
                          <td className="py-1.5 text-stone-500">{c.avgCost != null ? `R ${c.avgCost.toFixed(0)}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Open issues */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-stone-900">
          Open Issues
          {openLogs.length > 0 && (
            <span className="ml-2 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {openLogs.length}
            </span>
          )}
        </h2>

        {openLogs.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-5 text-sm text-green-700">
            ✓ No open maintenance issues.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <THead />
              <tbody className="divide-y divide-stone-100">
                {openLogs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Equipment register */}
      {equipment.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center text-sm text-stone-400">
          No equipment registered yet. Add units to the{" "}
          <code className="rounded bg-stone-100 px-1">equipment</code> table.
        </div>
      ) : (
        <div>
          <h2 className="mb-3 text-base font-semibold text-stone-900">
            Equipment Register
          </h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                  <th className="px-4 py-3">Unit</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {equipment.map((e) => (
                  <EquipmentRow key={e.id} equipment={e} id={e.id} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full repair log */}
      {logs.length > 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-stone-900">
            Repair Log
          </h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <THead />
              <tbody className="divide-y divide-stone-100">
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function THead() {
  return (
    <thead>
      <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
        <th className="px-4 py-3">Unit</th>
        <th className="px-4 py-3">Issue</th>
        <th className="px-4 py-3">Priority</th>
        <th className="px-4 py-3">Status</th>
        <th className="px-4 py-3">Reported</th>
        <th className="px-4 py-3">Resolved</th>
        <th className="px-4 py-3">By</th>
      </tr>
    </thead>
  );
}

function LogRow({ log }: { log: MaintenanceLog }) {
  const sts =
    repairStatusConfig[log.repair_status as keyof typeof repairStatusConfig] ??
    repairStatusConfig.open;
  const pri =
    priorityBadge[log.priority as keyof typeof priorityBadge] ??
    priorityBadge.medium;

  return (
    <tr className="hover:bg-stone-50">
      <td className="whitespace-nowrap px-4 py-3">
        <p className="font-medium text-stone-800">{log.unit_name}</p>
        <p className="text-xs capitalize text-stone-400">{log.category}</p>
      </td>
      <td className="px-4 py-3 max-w-[220px]">
        <p className="font-medium text-stone-700">{log.issue_title}</p>
        {log.issue_description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-stone-400">
            {log.issue_description}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-semibold capitalize",
            pri
          )}
        >
          {log.priority}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            sts.badge
          )}
        >
          {sts.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-400">
        {formatShortDate(log.date_reported)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-400">
        {(log.date_fixed ?? log.date_resolved) ? formatShortDate((log.date_fixed ?? log.date_resolved)!) : "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">
        {log.fixed_by ?? log.resolved_by ?? "—"}
      </td>
    </tr>
  );
}

function EquipmentRow({ equipment: e, id }: { equipment: Equipment; id: string }) {
  return (
    <tr className={cn("hover:bg-stone-50", e.status === "out_of_service" && "bg-red-50")}>
      <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
        {e.unit_name}
      </td>
      <td className="whitespace-nowrap px-4 py-3 capitalize text-stone-500">
        {e.category}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-400">
        {e.location ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <EditStatusButton equipmentId={id} currentStatus={e.status} />
      </td>
      <td className="px-4 py-3 max-w-[200px] text-xs text-stone-400">
        {e.notes ? (
          <span className="line-clamp-1">{e.notes}</span>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <Link
          href={`/dashboard/maintenance/equipment/${id}`}
          className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
        >
          View Details →
        </Link>
      </td>
    </tr>
  );
}

function SummaryCard({
  label,
  value,
  color = "stone",
}: {
  label: string;
  value: number;
  color?: "green" | "amber" | "red" | "stone";
}) {
  const colorMap = {
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
    stone: "border-stone-200 bg-white",
  };
  const textMap = {
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    stone: "text-stone-900",
  };

  return (
    <div className={cn("rounded-lg border px-4 py-4", colorMap[color])}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", textMap[color])}>{value}</p>
    </div>
  );
}
