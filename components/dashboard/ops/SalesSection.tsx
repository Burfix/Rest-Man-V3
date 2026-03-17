import { SalesSummary, SalesItem } from "@/types";
import { formatCurrency, formatShortDate, todayISO } from "@/lib/utils";

function uploadAgeLabel(uploadedAt: string): { label: string; stale: boolean } {
  const today = new Date(todayISO());
  const uploaded = new Date(uploadedAt.slice(0, 10));
  const diffDays = Math.round(
    (today.getTime() - uploaded.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return { label: "Uploaded today", stale: false };
  if (diffDays === 1) return { label: "Uploaded yesterday", stale: false };
  return { label: `Uploaded ${diffDays} days ago`, stale: diffDays > 7 };
}

interface Props {
  summary: SalesSummary;
}

export default function SalesSection({ summary }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          Weekly Sales
        </h2>
        <a
          href="/dashboard/sales"
          className="text-xs font-medium text-stone-400 hover:text-stone-700"
        >
          Sales history →
        </a>
      </div>

      {!summary.upload ? (
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/50 px-5 py-5">
          <p className="text-sm font-semibold text-stone-600 dark:text-stone-300">
            No sales data — weekly performance tracking inactive
          </p>
          <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
            Upload a weekly POS export to track top items, revenue trends and
            category performance.
          </p>
          <a
            href="/dashboard/sales"
            className="mt-3 inline-block rounded-lg bg-stone-900 dark:bg-stone-100 px-4 py-1.5 text-xs font-semibold text-white dark:text-stone-900 hover:bg-stone-700 dark:hover:bg-stone-200 transition-colors"
          >
            Upload sales data
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Upload summary header */}
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-stone-800">
                  {summary.upload.week_label}
                </p>
                <p className="text-xs text-stone-400">
                  {formatShortDate(summary.upload.week_start)} –{" "}
                  {formatShortDate(summary.upload.week_end)}
                </p>
                {(() => {
                  const { label, stale } = uploadAgeLabel(summary.upload.uploaded_at);
                  return (
                    <p className={`mt-1 text-xs font-medium ${stale ? "text-amber-600" : "text-stone-400"}`}>
                      {stale ? "⚠ " : ""}{label}
                    </p>
                  );
                })()}
              </div>
              <div className="flex gap-4 text-right">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                    Items Sold
                  </p>
                  <p className="text-xl font-bold text-stone-900">
                    {summary.upload.total_items_sold.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-stone-400">
                    Sales Value
                  </p>
                  <p className="text-xl font-bold text-stone-900">
                    {formatCurrency(summary.upload.total_sales_value)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Top / Bottom tables */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ItemsTable
              title="Top 5 by Quantity"
              items={summary.topItems}
              variant="top"
            />
            <ItemsTable
              title="Bottom 5 by Quantity"
              items={summary.bottomItems}
              variant="bottom"
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ItemsTable({
  title,
  items,
  variant,
}: {
  title: string;
  items: SalesItem[];
  variant: "top" | "bottom";
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="border-b border-stone-100 px-4 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {title}
        </p>
      </div>
      <table className="min-w-full divide-y divide-stone-100 text-sm">
        <tbody className="divide-y divide-stone-50">
          {items.map((item, i) => (
            <tr key={item.id} className="hover:bg-stone-50">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      variant === "top"
                        ? "text-xs font-bold text-green-600"
                        : "text-xs font-bold text-stone-400"
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="font-medium text-stone-800">
                    {item.item_name}
                  </span>
                </div>
                {item.category && (
                  <p className="ml-5 text-xs text-stone-400">{item.category}</p>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">
                <span className="font-semibold text-stone-900">
                  {item.quantity_sold.toLocaleString()}
                </span>
                <span className="ml-1 text-xs text-stone-400">units</span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-stone-500">
                {formatCurrency(item.total_value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
