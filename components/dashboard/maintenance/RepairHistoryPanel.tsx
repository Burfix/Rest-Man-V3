"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EquipmentRepair } from "@/types";
import LogRepairForm from "@/components/dashboard/maintenance/LogRepairForm";
import { cn } from "@/lib/utils";

interface Props {
  equipmentId: string;
  repairs: EquipmentRepair[];
}

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(n: number | null) {
  if (n === null || n === undefined) return "—";
  return `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RepairHistoryPanel({ equipmentId, repairs: initialRepairs }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900">Repair History</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 transition-colors"
        >
          {showForm ? "✕ Cancel" : "+ Log Repair"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <LogRepairForm
            equipmentId={equipmentId}
            onClose={() => { setShowForm(false); router.refresh(); }}
          />
        </div>
      )}

      {initialRepairs.length === 0 && !showForm ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">No repairs logged yet.</p>
      ) : (
        <div className="space-y-3">
          {initialRepairs.map((repair) => (
            <div key={repair.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              {/* Date + cost row */}
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                  {formatDate(repair.repair_date)}
                </span>
                {repair.repair_cost !== null && (
                  <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-700">
                    {formatCurrency(repair.repair_cost)}
                  </span>
                )}
              </div>

              {/* Contractor */}
              {(repair.contractor_name || repair.contractor_company) && (
                <p className="mt-1.5 text-sm font-medium text-stone-800">
                  {repair.contractor_name}
                  {repair.contractor_company && <span className="text-stone-500 font-normal"> · {repair.contractor_company}</span>}
                  {repair.contractor_phone && <span className="text-stone-500 dark:text-stone-400 font-normal"> · {repair.contractor_phone}</span>}
                </p>
              )}

              {/* Issue */}
              {repair.issue_reported && (
                <div className="mt-2">
                  <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Issue: </span>
                  <span className="text-sm text-stone-700">{repair.issue_reported}</span>
                </div>
              )}

              {/* Work done */}
              {repair.work_done && (
                <div className="mt-1">
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Work done: </span>
                  <span className="text-sm text-stone-700">{repair.work_done}</span>
                </div>
              )}

              {/* Footer row */}
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-stone-100 pt-2">
                {repair.next_service_due && (
                  <span className="text-xs text-stone-500">
                    Next service: <strong className="text-stone-700">{formatDate(repair.next_service_due)}</strong>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
