/**
 * Equipment detail page — /dashboard/maintenance/equipment/[id]
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  getEquipmentById,
  getRepairsByEquipmentId,
} from "@/services/ops/maintenanceSummary";
import RepairHistoryPanel from "@/components/dashboard/maintenance/RepairHistoryPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const statusConfig = {
  operational:     { badge: "bg-green-50 text-green-700 ring-1 ring-green-200", label: "Operational" },
  needs_attention: { badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200", label: "Needs Attention" },
  out_of_service:  { badge: "bg-red-50 text-red-700 ring-1 ring-red-200",       label: "Out of Service" },
} as const;

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function warrantyBadge(expiry: string | null) {
  if (!expiry) return null;
  const today = Date.now();
  const exp = new Date(expiry).getTime();
  const daysLeft = Math.ceil((exp - today) / 86400000);
  if (daysLeft < 0) return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Warranty Expired</span>;
  if (daysLeft <= 60) return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Warranty Expiring in {daysLeft}d</span>;
  return <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Warranty Valid</span>;
}

interface PageProps {
  params: { id: string };
}

export default async function EquipmentDetailPage({ params }: PageProps) {
  const [equipment, repairs] = await Promise.all([
    getEquipmentById(params.id),
    getRepairsByEquipmentId(params.id).catch(() => []),
  ]);

  if (!equipment) notFound();

  const cfg = statusConfig[equipment.status] ?? statusConfig.operational;
  const totalCost = repairs.reduce((s, r) => s + (r.repair_cost ?? 0), 0);
  const lastRepair = repairs[0] ?? null;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-stone-400">
        <Link href="/dashboard/maintenance" className="hover:text-stone-700 transition-colors">
          Maintenance
        </Link>
        <span>/</span>
        <span className="text-stone-700 font-medium">{equipment.unit_name}</span>
      </div>

      {/* Header card */}
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">{equipment.unit_name}</h1>
            <p className="mt-0.5 text-sm text-stone-500 capitalize">
              {equipment.category} · {equipment.location ?? "No location set"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", cfg.badge)}>
              {cfg.label}
            </span>
            {warrantyBadge(equipment.warranty_expiry)}
          </div>
        </div>

        {/* Asset info grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-stone-100 pt-5">
          <InfoCell label="Serial Number"  value={equipment.serial_number} />
          <InfoCell label="Supplier"       value={equipment.supplier} />
          <InfoCell label="Purchase Date"  value={formatDate(equipment.purchase_date)} />
          <InfoCell label="Warranty Expiry" value={formatDate(equipment.warranty_expiry)} />
        </div>

        {/* Repair stats */}
        {repairs.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-4 border-t border-stone-100 pt-4">
            <StatCell label="Total Repairs" value={String(repairs.length)} />
            <StatCell label="Total Repair Cost" value={`R${totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`} />
            <StatCell label="Last Serviced" value={formatDate(lastRepair?.repair_date ?? null)} />
          </div>
        )}

        {equipment.notes && (
          <p className="mt-4 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-sm text-stone-600 border-t">
            <span className="font-medium text-stone-700">Notes: </span>{equipment.notes}
          </p>
        )}
      </div>

      {/* Repair history + log form */}
      <RepairHistoryPanel equipmentId={equipment.id} repairs={repairs} />
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-stone-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-stone-800">{value || "—"}</dd>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-stone-400 uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-base font-bold text-stone-900">{value}</dd>
    </div>
  );
}
