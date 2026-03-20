/**
 * Compliance Hub page — /dashboard/compliance
 *
 * Server component: fetches all compliance items + aggregate summary,
 * then hands off to the interactive ComplianceHub client component.
 */

import { getAllComplianceItems, getComplianceSummary } from "@/services/ops/complianceSummary";
import ComplianceHub from "@/components/dashboard/compliance/ComplianceHub";
import type { ComplianceItem, ComplianceSummary } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY_SUMMARY: ComplianceSummary = {
  total: 0,
  compliant: 0,
  scheduled: 0,
  due_soon: 0,
  expired: 0,
  unknown: 0,
  compliance_pct: 0,
  critical_items: [],
  due_soon_items: [],
  scheduled_items: [],
};

export default async function CompliancePage() {
  let items: ComplianceItem[] = [];
  let summary: ComplianceSummary = EMPTY_SUMMARY;
  let loadError: string | null = null;

  try {
    [items, summary] = await Promise.all([
      getAllComplianceItems(),
      getComplianceSummary(),
    ]);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load compliance data.";
  }

  return (
    <div className="max-w-6xl">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <h1 className="text-xl font-bold text-stone-900">Compliance Hub</h1>
            <p className="text-sm text-stone-500">
              Track certificates, inspections, and legal obligations for your venue.
            </p>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8">
          <p className="text-sm font-semibold text-red-700">Failed to load compliance data</p>
          <p className="mt-1 text-xs text-red-500">{loadError}</p>
          <p className="mt-3 text-xs text-stone-500">
            Ensure the <code className="font-mono text-xs bg-red-100 px-1 py-0.5 rounded">compliance_items</code> table
            exists. Run <code className="font-mono text-xs bg-red-100 px-1 py-0.5 rounded">010_compliance.sql</code> in
            the Supabase SQL editor.
          </p>
        </div>
      ) : (
        <ComplianceHub items={items} summary={summary} />
      )}
    </div>
  );
}
