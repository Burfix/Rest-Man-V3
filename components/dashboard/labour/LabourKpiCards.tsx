/**
 * components/dashboard/labour/LabourKpiCards.tsx
 *
 * KPI tiles: total cost, hours, labour %, overtime, active staff.
 */
"use client";

import { cn } from "@/lib/utils";
import type { LabourDashboardSummary } from "@/types/labour";

interface Props {
  summary: LabourDashboardSummary;
}

function formatCurrency(v: number): string {
  return `R${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatHours(v: number): string {
  return `${v.toFixed(1)}h`;
}

interface KpiTile {
  label: string;
  value: string;
  sub?: string;
  color: string;
}

export default function LabourKpiCards({ summary }: Props) {
  const tiles: KpiTile[] = [
    {
      label: "Labour Cost Today",
      value: formatCurrency(summary.totalLabourCost),
      sub: summary.labourPercentOfSales != null
        ? `${summary.labourPercentOfSales.toFixed(1)}% of sales`
        : undefined,
      color: "border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
    },
    {
      label: "Labour Hours Today",
      value: formatHours(summary.totalLabourHours),
      sub: `${summary.regularHours.toFixed(1)}h reg + ${summary.overtimeHours.toFixed(1)}h OT`,
      color: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
    },
    {
      label: "Labour % of Sales",
      value: summary.labourPercentOfSales != null
        ? `${summary.labourPercentOfSales.toFixed(1)}%`
        : "—",
      sub: summary.netSales != null ? `on ${formatCurrency(summary.netSales)} net` : "sales data unavailable",
      color: summary.alerts.labourAboveTarget
        ? "border-red-100 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        : "border-green-100 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
    },
    {
      label: "Overtime Cost",
      value: formatCurrency(summary.overtimeCost),
      sub: formatHours(summary.overtimeHours),
      color: summary.alerts.overtimeAboveThreshold
        ? "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
    },
    {
      label: "Active Staff",
      value: String(summary.activeStaffCount),
      sub: summary.openTimecardCount > 0
        ? `${summary.openTimecardCount} still clocked in`
        : "all clocked out",
      color: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={cn("rounded-lg border px-4 py-3", t.color)}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
            {t.label}
          </p>
          <p className="mt-1 text-2xl font-bold leading-tight">{t.value}</p>
          {t.sub && (
            <p className="mt-0.5 text-[11px] opacity-60">{t.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
