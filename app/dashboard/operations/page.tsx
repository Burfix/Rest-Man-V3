/**
 * /dashboard/operations
 * Upload a new daily operations report + see the latest summary.
 * Live-first: when MICROS is connected and recently synced, CSV upload is de-emphasised.
 */

import { getDailyOperationsDashboardSummary, getDailyOperationsHistory } from "@/services/ops/dailyOperationsSummary";
import { getMicrosStatus } from "@/services/micros/status";
import DailyOpsUploadForm from "@/components/dashboard/DailyOpsUploadForm";
import { formatShortDate, formatCurrency, todayISO } from "@/lib/utils";
import Link from "next/link";
import type { MicrosStatusSummary } from "@/types/micros";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OperationsPage() {
  const [summary, history, microsStatus] = await Promise.all([
    getDailyOperationsDashboardSummary().catch(() => ({
      latestReport: null,
      reportDate: null,
      uploadedAt: null,
    })),
    getDailyOperationsHistory(10).catch(() => []),
    getMicrosStatus().catch(() => null),
  ]);

  const ms = microsStatus as MicrosStatusSummary | null;
  const microsConnectedToday =
    ms?.isConfigured && ms.latestDailySales?.business_date === todayISO();
  const microsStale =
    ms?.isConfigured && !microsConnectedToday && ms.minutesSinceSync != null;
  const microsAgeLabel = ms?.minutesSinceSync != null
    ? ms.minutesSinceSync < 1 ? "just now"
      : ms.minutesSinceSync < 60 ? `${ms.minutesSinceSync} min ago`
      : `${Math.floor(ms.minutesSinceSync / 60)}h ago`
    : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Daily Operations</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Upload and review Daily Operations reports from Toast POS
        </p>
      </div>

      {/* ── MICROS live status banner ── */}
      {microsConnectedToday && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Live data connected — manual upload not required
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              MICROS is syncing live sales data for today. CSV upload is available below for overrides or historical backfill only.
              {microsAgeLabel && <> Last sync: {microsAgeLabel}.</>}
            </p>
          </div>
        </div>
      )}
      {microsStale && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              Live sync stale — CSV upload recommended
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              MICROS is configured but today&apos;s data has not synced yet.
              {microsAgeLabel && <> Last sync: {microsAgeLabel}.</>}{" "}
              Upload a Toast Daily Ops CSV to fill the gap.
            </p>
          </div>
        </div>
      )}
      {ms && !ms.isConfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-stone-400" />
          <div>
            <p className="text-sm font-semibold text-stone-700">
              Manual mode — MICROS not connected
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              Upload a Toast Daily Ops CSV each day.{" "}
              <Link href="/dashboard/settings/integrations" className="underline hover:text-stone-700">Configure MICROS →</Link>
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Upload form — de-emphasised when MICROS live */}
        <div>
          {microsConnectedToday && (
            <p className="mb-2 text-xs font-medium text-stone-400 uppercase tracking-widest">
              Manual override / backfill
            </p>
          )}
          <DailyOpsUploadForm />
        </div>

        {/* Latest report summary */}
        <div>
          {summary.latestReport ? (
            <div className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-stone-800">Latest Report</h3>
                <Link
                  href={`/dashboard/operations/${summary.latestReport.report_date}`}
                  className="text-xs font-medium text-stone-400 hover:text-stone-700"
                >
                  Full detail →
                </Link>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <MetricItem label="Date" value={formatShortDate(summary.latestReport.report_date)} />
                <MetricItem label="Sales Net VAT" value={formatCurrency(summary.latestReport.sales_net_vat)} />
                <MetricItem
                  label="Operating Margin"
                  value={summary.latestReport.margin_percent != null ? `${summary.latestReport.margin_percent.toFixed(2)}%` : "—"}
                  highlight={summary.latestReport.margin_percent != null && summary.latestReport.margin_percent < 8 ? "red" : undefined}
                />
                <MetricItem
                  label="Labor Cost %"
                  value={summary.latestReport.labor_cost_percent != null ? `${summary.latestReport.labor_cost_percent.toFixed(2)}%` : "—"}
                  highlight={summary.latestReport.labor_cost_percent != null && summary.latestReport.labor_cost_percent > 65 ? "amber" : undefined}
                />
                <MetricItem label="COGS %" value={summary.latestReport.cogs_percent != null ? `${summary.latestReport.cogs_percent.toFixed(2)}%` : "—"} />
                <MetricItem label="Guests" value={summary.latestReport.guest_count != null ? String(summary.latestReport.guest_count) : "—"} />
                <MetricItem label="Checks" value={summary.latestReport.check_count != null ? String(summary.latestReport.check_count) : "—"} />
                <MetricItem label="Cash Due" value={formatCurrency(summary.latestReport.cash_due)} />
              </dl>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
              <p className="text-sm font-medium text-stone-500">No reports uploaded yet</p>
              <p className="mt-1 text-xs text-stone-400">
                Upload your first Toast Daily Operations CSV to get started.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Recent history table */}
      {history.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base font-semibold text-stone-900">Recent Reports</h2>
            <Link href="/dashboard/operations/history" className="text-xs font-medium text-stone-400 hover:text-stone-700">
              Full history →
            </Link>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <table className="min-w-full divide-y divide-stone-100 text-sm">
              <thead className="bg-stone-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Sales Net VAT</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Margin %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Labor %</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-stone-500">Guests</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {history.map((r) => (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3 font-medium text-stone-900">{formatShortDate(r.report_date)}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{formatCurrency(r.sales_net_vat)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${r.margin_percent != null && r.margin_percent < 8 ? "text-red-700" : "text-stone-700"}`}>
                      {r.margin_percent != null ? `${r.margin_percent.toFixed(1)}%` : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${r.labor_cost_percent != null && r.labor_cost_percent > 65 ? "text-amber-700" : "text-stone-700"}`}>
                      {r.labor_cost_percent != null ? `${r.labor_cost_percent.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-700">{r.guest_count ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/operations/${r.report_date}`} className="text-xs font-medium text-stone-400 hover:text-stone-700">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function MetricItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "amber";
}) {
  return (
    <div className="rounded border border-stone-100 bg-stone-50 px-3 py-2">
      <dt className="text-xs font-medium text-stone-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${highlight === "red" ? "text-red-700" : highlight === "amber" ? "text-amber-700" : "text-stone-900"}`}>
        {value}
      </dd>
    </div>
  );
}
