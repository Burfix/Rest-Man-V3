/**
 * /dashboard/operations/history
 * Full history of all uploaded daily operations reports.
 */

import { getDailyOperationsHistory } from "@/services/ops/dailyOperationsSummary";
import { formatShortDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OperationsHistoryPage() {
  const history = await getDailyOperationsHistory(90).catch(() => []);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <Link href="/dashboard/operations" className="text-xs font-medium text-stone-400 hover:text-stone-700">
            ← Back to Operations
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-stone-900">Reports History</h1>
          <p className="mt-0.5 text-sm text-stone-500">Last {history.length} daily operations reports</p>
        </div>
        <Link
          href="/dashboard/operations"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
        >
          Upload report
        </Link>
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-stone-500">No reports uploaded yet</p>
          <Link href="/dashboard/operations" className="mt-3 inline-block text-sm font-medium text-stone-700 underline">
            Upload your first report
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
          <table className="min-w-full divide-y divide-stone-100 text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Sales Net VAT</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Op. Margin</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Margin %</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Labor %</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">COGS %</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Guests</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Checks</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {history.map((r) => {
                const laborHigh = r.labor_cost_percent != null && r.labor_cost_percent > 65;
                const marginLow = r.margin_percent != null && r.margin_percent < 8;
                return (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900 whitespace-nowrap">{formatShortDate(r.report_date)}</td>
                    <td className="px-4 py-3 text-right text-stone-700 whitespace-nowrap">{formatCurrency(r.sales_net_vat)}</td>
                    <td className="px-4 py-3 text-right text-stone-700 whitespace-nowrap">{formatCurrency(r.operating_margin)}</td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${marginLow ? "text-red-700" : "text-stone-700"}`}>
                      {r.margin_percent != null ? `${r.margin_percent.toFixed(1)}%` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${laborHigh ? "text-amber-700" : "text-stone-700"}`}>
                      {r.labor_cost_percent != null ? `${r.labor_cost_percent.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-700 whitespace-nowrap">
                      {r.cogs_percent != null ? `${r.cogs_percent.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-700">{r.guest_count ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{r.check_count ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/operations/${r.report_date}`} className="text-xs font-medium text-stone-400 hover:text-stone-700 whitespace-nowrap">
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
