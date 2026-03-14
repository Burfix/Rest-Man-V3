/**
 * /dashboard/operations/[date]
 * Full detail view for a single daily operations report.
 */

import { getDailyOperationsDetailByDate } from "@/services/ops/dailyOperationsSummary";
import { formatDisplayDate, formatShortDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: { date: string };
}

export default async function DailyOpsDetailPage({ params }: Props) {
  const detail = await getDailyOperationsDetailByDate(params.date).catch(() => null);
  if (!detail) notFound();

  const { report: r, laborRows, revenueCenters } = detail;

  const laborHigh = r.labor_cost_percent != null && r.labor_cost_percent > 65;
  const marginLow = r.margin_percent != null && r.margin_percent < 8;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/operations" className="text-xs font-medium text-stone-400 hover:text-stone-700">
            ← Back to Operations
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-stone-900">
            {formatDisplayDate(r.report_date)}
          </h1>
          {r.source_file_name && (
            <p className="mt-0.5 text-xs text-stone-400">Source: {r.source_file_name}</p>
          )}
        </div>
      </div>

      {/* Alerts */}
      {(laborHigh || marginLow) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-1">
          {laborHigh && <p>⚠ Labor cost is elevated at {r.labor_cost_percent?.toFixed(2)}% (threshold: 65%)</p>}
          {marginLow && <p>⚠ Operating margin is below target at {r.margin_percent?.toFixed(2)}% (threshold: 8%)</p>}
        </div>
      )}

      {/* Key metrics grid */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-stone-900">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Sales Net VAT" value={formatCurrency(r.sales_net_vat)} />
          <StatCard
            label="Operating Margin %"
            value={r.margin_percent != null ? `${r.margin_percent.toFixed(2)}%` : "—"}
            highlight={marginLow ? "red" : undefined}
          />
          <StatCard
            label="Labor Cost %"
            value={r.labor_cost_percent != null ? `${r.labor_cost_percent.toFixed(2)}%` : "—"}
            highlight={laborHigh ? "amber" : undefined}
          />
          <StatCard label="COGS %" value={r.cogs_percent != null ? `${r.cogs_percent.toFixed(2)}%` : "—"} />
          <StatCard label="Guests" value={r.guest_count != null ? String(r.guest_count) : "—"} />
          <StatCard label="Checks" value={r.check_count != null ? String(r.check_count) : "—"} />
          <StatCard label="Avg Spend / Guest" value={formatCurrency(r.guests_average_spend)} />
          <StatCard label="Avg Spend / Check" value={formatCurrency(r.checks_average_spend)} />
        </div>
      </section>

      {/* Financial Control */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-stone-900">Financial Control</h2>
        <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
          <table className="min-w-full divide-y divide-stone-100 text-sm">
            <tbody className="divide-y divide-stone-100">
              <FinRow label="Gross Sales (before discounts)" value={formatCurrency(r.gross_sales_before_discounts)} />
              <FinRow label="Total Discounts" value={formatCurrency(r.total_discounts)} />
              <FinRow label="Gross Sales (after discounts)" value={formatCurrency(r.gross_sales_after_discounts)} />
              <FinRow label="Tax Collected" value={formatCurrency(r.tax_collected)} />
              <FinRow label="Service Charges" value={formatCurrency(r.service_charges)} />
              <FinRow label="Non-Revenue Total" value={formatCurrency(r.non_revenue_total)} />
              <FinRow label="Cost of Goods Sold" value={formatCurrency(r.cost_of_goods_sold)} bold />
              <FinRow label="Labor Cost" value={formatCurrency(r.labor_cost)} bold />
              <FinRow label="Operating Margin" value={formatCurrency(r.operating_margin)} bold highlight={marginLow ? "red" : undefined} />
              <FinRow label="Cash In" value={formatCurrency(r.cash_in)} />
              <FinRow label="Paid In" value={formatCurrency(r.paid_in)} />
              <FinRow label="Paid Out" value={formatCurrency(r.paid_out)} />
              <FinRow label="Cash Due" value={formatCurrency(r.cash_due)} />
              <FinRow label="Deposits" value={formatCurrency(r.deposits)} />
              <FinRow label="Over/Short" value={formatCurrency(r.over_short)} />
            </tbody>
          </table>
        </div>
      </section>

      {/* Revenue Centers */}
      {revenueCenters.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Revenue Centers</h2>
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Center</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Sales Net VAT</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">% of Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Guests</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Avg/Guest</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Checks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {revenueCenters.map((rc) => (
                  <tr key={rc.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{rc.revenue_center_name}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{formatCurrency(rc.sales_net_vat)}</td>
                    <td className="px-4 py-3 text-right text-stone-500">
                      {rc.percent_of_total_sales != null ? `${rc.percent_of_total_sales.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-700">{rc.guests ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{formatCurrency(rc.average_spend_per_guest)}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{rc.checks ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Labor */}
      {laborRows.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Labor by Job Code</h2>
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Job Code</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Reg Hrs</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">OT Hrs</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Total Hrs</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Total Pay</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Labor %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {laborRows.map((l) => (
                  <tr key={l.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{l.job_code_name}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{l.regular_hours?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{l.overtime_hours?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{l.total_hours?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{formatCurrency(l.total_pay)}</td>
                    <td className="px-4 py-3 text-right text-stone-700">
                      {l.labor_cost_percent != null ? `${l.labor_cost_percent.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Checks + Service Performance + Tips */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Checks */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Checks</h2>
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <tbody className="divide-y divide-stone-100">
                <MiniRow label="Returns" count={r.returns_count} amount={formatCurrency(r.returns_amount)} />
                <MiniRow label="Voids" count={r.voids_count} amount={formatCurrency(r.voids_amount)} />
                <MiniRow label="Manager Voids" count={r.manager_voids_count} amount={formatCurrency(r.manager_voids_amount)} />
                <MiniRow label="Error Corrects" count={r.error_corrects_count} amount={formatCurrency(r.error_corrects_amount)} />
                <MiniRow label="Cancels" count={r.cancels_count} amount={formatCurrency(r.cancels_amount)} />
              </tbody>
            </table>
          </div>
        </section>

        {/* Service Performance */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Service Performance</h2>
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <tbody className="divide-y divide-stone-100">
                <FinRow label="Avg Spend / Guest" value={formatCurrency(r.guests_average_spend)} />
                <FinRow label="Avg Spend / Check" value={formatCurrency(r.checks_average_spend)} />
                <FinRow label="Table Turns" value={r.table_turns_count != null ? String(r.table_turns_count) : "—"} />
                <FinRow label="Avg Spend / Turn" value={formatCurrency(r.table_turns_average_spend)} />
                <FinRow label="Avg Dining Time (hrs)" value={r.average_dining_time_hours != null ? r.average_dining_time_hours.toFixed(2) : "—"} />
              </tbody>
            </table>
          </div>
        </section>

        {/* Tips */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Tips</h2>
          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <tbody className="divide-y divide-stone-100">
                <FinRow label="Direct Charged Tips" value={formatCurrency(r.direct_charged_tips)} />
                <FinRow label="Direct Cash Tips" value={formatCurrency(r.direct_cash_tips)} />
                <FinRow label="Indirect Tips" value={formatCurrency(r.indirect_tips)} />
                <FinRow label="Total Tips" value={formatCurrency(r.total_tips)} bold />
                <FinRow label="Tips Paid" value={formatCurrency(r.tips_paid)} />
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "amber";
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${highlight === "red" ? "text-red-700" : highlight === "amber" ? "text-amber-700" : "text-stone-900"}`}>
        {value}
      </p>
    </div>
  );
}

function FinRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: "red" | "amber";
}) {
  return (
    <tr className="hover:bg-stone-50">
      <td className={`px-4 py-2.5 ${bold ? "font-semibold text-stone-900" : "text-stone-600"}`}>{label}</td>
      <td className={`px-4 py-2.5 text-right ${bold ? "font-semibold" : ""} ${highlight === "red" ? "text-red-700" : highlight === "amber" ? "text-amber-700" : "text-stone-900"}`}>
        {value}
      </td>
    </tr>
  );
}

function MiniRow({
  label,
  count,
  amount,
}: {
  label: string;
  count: number | null | undefined;
  amount: string;
}) {
  return (
    <tr className="hover:bg-stone-50">
      <td className="px-4 py-2.5 text-stone-600">{label}</td>
      <td className="px-4 py-2.5 text-right text-stone-500">{count ?? 0}×</td>
      <td className="px-4 py-2.5 text-right text-stone-900">{amount}</td>
    </tr>
  );
}
