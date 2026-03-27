/**
 * Sales page — weekly upload history and item breakdown.
 */

import {
  getAllSalesUploads,
  getSalesItemsByUpload,
} from "@/services/ops/salesSummary";
import { SalesItem, SalesUpload } from "@/types";
import { cn, formatCurrency, formatShortDate } from "@/lib/utils";
import Link from "next/link";
import SalesUploadForm from "@/components/dashboard/SalesUploadForm";
import { getUserContext } from "@/lib/auth/get-user-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPage() {
  let uploads: SalesUpload[] = [];
  let latestItems: SalesItem[] = [];
  let loadError: string | null = null;

  let siteId: string | undefined;
  try {
    const ctx = await getUserContext();
    siteId = ctx.siteId;
  } catch {
    // Not authenticated — middleware should prevent this
  }

  try {
    uploads = await getAllSalesUploads(siteId);
    if (uploads.length > 0) {
      latestItems = await getSalesItemsByUpload(uploads[0].id);
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load sales data.";
  }

  const latest = uploads[0] ?? null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Sales</h1>
        <p className="mt-0.5 text-sm text-stone-500">Weekly POS upload history</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        <span className="-mb-px border-b-2 border-stone-900 px-4 py-2 text-sm font-semibold text-stone-900">
          Weekly Items
        </span>
        <Link
          href="/dashboard/sales/historical"
          className="px-4 py-2 text-sm font-medium text-stone-400 hover:text-stone-700"
        >
          Historical Daily
        </Link>
      </div>

      {/* Upload form */}
      <SalesUploadForm />

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {uploads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-stone-600">
            No sales data uploaded yet
          </p>
          <p className="mt-1 text-xs text-stone-400">
            Use the upload form above to import your first weekly POS export.
          </p>
        </div>
      ) : (
        <>
          {/* Latest week detail */}
          {latest && (
            <div className="space-y-4">
              <div className="rounded-lg border border-stone-200 bg-white px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-stone-900">
                      {latest.week_label}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {formatShortDate(latest.week_start)} –{" "}
                      {formatShortDate(latest.week_end)}
                    </p>
                  </div>
                  <div className="flex gap-6">
                    <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                        Items Sold
                      </p>
                      <p className="text-2xl font-bold text-stone-900">
                        {latest.total_items_sold.toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                        Sales Value
                      </p>
                      <p className="text-2xl font-bold text-stone-900">
                        {formatCurrency(latest.total_sales_value)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items table */}
              {latestItems.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-stone-200">
                  <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
                    <thead>
                      <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">Item</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-right">Qty Sold</th>
                        <th className="px-4 py-3 text-right">Unit Price</th>
                        <th className="px-4 py-3 text-right">Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {latestItems.map((item, i) => (
                        <SalesItemRow key={item.id} item={item} rank={i + 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Upload history */}
          {uploads.length > 1 && (
            <div>
              <h2 className="mb-3 text-base font-semibold text-stone-900">
                Upload History
              </h2>
              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
                  <thead>
                    <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-400">
                      <th className="px-4 py-3">Week</th>
                      <th className="px-4 py-3">Date Range</th>
                      <th className="px-4 py-3 text-right">Items Sold</th>
                      <th className="px-4 py-3 text-right">Sales Value</th>
                      <th className="px-4 py-3 text-right">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {uploads.map((u) => (
                      <tr key={u.id} className="hover:bg-stone-50">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-800">
                          {u.week_label}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">
                          {formatShortDate(u.week_start)} –{" "}
                          {formatShortDate(u.week_end)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-stone-700">
                          {u.total_items_sold.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-stone-900">
                          {formatCurrency(u.total_sales_value)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-stone-400">
                          {formatShortDate(u.uploaded_at.slice(0, 10))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SalesItemRow({ item, rank }: { item: SalesItem; rank: number }) {
  return (
    <tr className="hover:bg-stone-50">
      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-stone-400">
        {rank}
      </td>
      <td className="px-4 py-3 font-medium text-stone-800">{item.item_name}</td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">
        {item.category ?? "—"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-stone-900">
        {item.quantity_sold.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-stone-400">
        {formatCurrency(item.unit_price)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-stone-700">
        {formatCurrency(item.total_value)}
      </td>
    </tr>
  );
}
