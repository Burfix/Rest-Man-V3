/**
 * components/dashboard/labour/LabourAlerts.tsx
 *
 * Alert badges for labour anomalies.
 */
"use client";

import { cn } from "@/lib/utils";
import type { LabourDashboardSummary } from "@/types/labour";

interface Props {
  alerts: LabourDashboardSummary["alerts"];
}

interface AlertBadge {
  key: string;
  label: string;
  show: boolean;
  color: string;
}

export default function LabourAlerts({ alerts }: Props) {
  const badges: AlertBadge[] = [
    {
      key: "labour-pct",
      label: "Labour % above target",
      show: alerts.labourAboveTarget,
      color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    },
    {
      key: "overtime",
      label: "Overtime above threshold",
      show: alerts.overtimeAboveThreshold,
      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    },
    {
      key: "unmapped",
      label: `${alerts.unmappedJobCodes} unmapped job code${alerts.unmappedJobCodes !== 1 ? "s" : ""}`,
      show: alerts.unmappedJobCodes > 0,
      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    },
    {
      key: "open-tc",
      label: `${alerts.openTimecardsOlderThanThreshold} open timecard${alerts.openTimecardsOlderThanThreshold !== 1 ? "s" : ""} > 10h`,
      show: alerts.openTimecardsOlderThanThreshold > 0,
      color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    },
  ];

  const visible = badges.filter((b) => b.show);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((b) => (
        <span
          key={b.key}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            b.color,
          )}
        >
          <span className="text-[10px]">!</span>
          {b.label}
        </span>
      ))}
    </div>
  );
}
