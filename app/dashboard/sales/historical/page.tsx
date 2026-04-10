/**
 * /dashboard/sales/historical
 *
 * Shows the same Mon–Sun week from last year (52 weeks ago).
 * Used for year-on-year comparison and revenue forecasting.
 */

import Link from "next/link";
import { getHistoricalSalesForWeek } from "@/services/ops/salesSummary";
import { HistoricalSale } from "@/types";
import { formatCurrency, formatDisplayDate } from "@/lib/utils";
import HistoricalSalesUploadForm from "@/components/dashboard/HistoricalSalesUploadForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun",    "Mon",    "Tue",     "Wed",       "Thu",      "Fri",    "Sat"];

function dayOfWeek(dateStr: string): string {
  return DAY_SHORT[new Date(dateStr + "T00:00:00").getDay()];
}
void DAY_FULL; // referenced via dayOfWeek — suppress unused warning

/**
 * Returns the Monday and Sunday of the same ISO week 52 weeks ago
 * (364 days back — preserves day-of-week alignment).
 */
function sameWeekLastYear(): { from: string; to: string; label: string } {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const daysFromMonday = (dow + 6) % 7; // 0=Mon … 6=Sun

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - daysFromMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const lyMonday = new Date(thisMonday);
  lyMonday.setDate(thisMonday.getDate() - 364); // 52 weeks back

  const lySunday = new Date(lyMonday);
  lySunday.setDate(lyMonday.getDate() + 6);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const fmtLabel = (d: Date) =>
    d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

  return {
    from: fmt(lyMonday),
    to:   fmt(lySunday),
    label: `${fmtLabel(lyMonday)} – ${fmtLabel(lySunday)}`,
  };
}

export default async function HistoricalSalesPage() {
  const { from, to, label } = sameWeekLastYear();

  let records: HistoricalSale[] = [];
  let loadError: string | null = null;

  try {
    records = await getHistoricalSalesForWeek(from, to);
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Failed to load historical sales.";
  }

  const weekTotal = records.reduce((s, r) => s + r.gross_sales, 0);
  const weekAvg   = records.length > 0 ? weekTotal / records.length : 0;
  const peakDay   = records.length > 0
    ? records.reduce((best, r) => (r.gross_sales > best.gross_sales ? r : best))
    : null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Sales</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Historical daily gross sales — comparison &amp; forecasting
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        <Link
          href="/dashboard/sales"
          className="px-4 py-2 text-sm font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700"
        >
          Weekly Items
        </Link>
        <span className="-mb-px border-b-2 border-stone-900 px-4 py-2 text-sm font-semibold text-stone-900">
          Historical Daily
        </span>
      </div>

      {/* Upload form */}
      <HistoricalSalesUploadForm />

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {/* Week scope banner */}
      <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
        <span className="text-lg">📅</span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-500">Same week last year</p>
          <p className="text-sm font-semibold text-blue-900">{label}</p>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-stone-600">
            No data for this week ({from} – {to})
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Upload a CSV covering this date range to populate the comparison.
          </p>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Days with data"      value={`${records.length} / 7`} />
            <StatCard label="Week total"           value={formatCurrency(weekTotal)} />
            <StatCard label="Daily average"        value={formatCurrency(weekAvg)} />
            <StatCard
              label="Peak day"
              value={peakDay ? `${dayOfWeek(peakDay.sale_date)} ${formatCurrency(peakDay.gross_sales)}` : "—"}
              small
            />
          </div>

          {/* Records table */}
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Day</th>
                  <th className="px-4 py-3 text-right">Gross Sales</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">
                    vs Week Avg
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {records.map((r) => {
                  const diff = r.gross_sales - weekAvg;
                  const pct = weekAvg > 0 ? (diff / weekAvg) * 100 : 0;
                  return (
                    <tr key={r.id} className="hover:bg-stone-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
                        {formatDisplayDate(r.sale_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500 dark:text-stone-400">
                        {dayOfWeek(r.sale_date)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-stone-900">
                        {formatCurrency(r.gross_sales)}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-right text-xs sm:table-cell">
                        <span
                          className={
                            pct >= 10
                              ? "font-medium text-green-600"
                              : pct <= -10
                              ? "font-medium text-red-500"
                              : "text-stone-500 dark:text-stone-400"
                          }
                        >
                          {pct >= 0 ? "+" : ""}
                          {pct.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p
        className={`mt-1 font-bold text-stone-900 ${small ? "text-sm leading-snug" : "text-xl"}`}
      >
        {value}
      </p>
    </div>
  );
}
