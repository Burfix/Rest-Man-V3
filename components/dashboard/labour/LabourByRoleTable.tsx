/**
 * components/dashboard/labour/LabourByRoleTable.tsx
 *
 * Labour cost breakdown by job code / role.
 */
"use client";

import { cn } from "@/lib/utils";
import type { LabourRoleSummary } from "@/types/labour";

interface Props {
  roles: LabourRoleSummary[];
}

function formatCurrency(v: number): string {
  return `R${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function LabourByRoleTable({ roles }: Props) {
  if (roles.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 text-center">
        <p className="text-sm text-stone-400 dark:text-stone-500">No role data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Labour by Role
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 dark:border-stone-800 text-left">
              <th className="px-4 py-2 text-xs font-medium text-stone-500 dark:text-stone-400">Role</th>
              <th className="px-4 py-2 text-xs font-medium text-stone-500 dark:text-stone-400 text-right">Staff</th>
              <th className="px-4 py-2 text-xs font-medium text-stone-500 dark:text-stone-400 text-right">Hours</th>
              <th className="px-4 py-2 text-xs font-medium text-stone-500 dark:text-stone-400 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr
                key={r.jobCodeRef}
                className="border-b border-stone-50 dark:border-stone-800/50 last:border-0"
              >
                <td className="px-4 py-2 font-medium text-stone-800 dark:text-stone-200">
                  {r.roleName}
                </td>
                <td className="px-4 py-2 text-right text-stone-600 dark:text-stone-400">
                  {r.staffCount}
                </td>
                <td className="px-4 py-2 text-right text-stone-600 dark:text-stone-400">
                  {r.hours.toFixed(1)}h
                </td>
                <td className="px-4 py-2 text-right font-semibold text-stone-800 dark:text-stone-200">
                  {formatCurrency(r.pay)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
