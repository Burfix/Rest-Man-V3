import { DailyOperationsDashboardSummary } from "@/types";
import { formatShortDate, formatCurrency } from "@/lib/utils";
import Link from "next/link";

interface Props {
  summary: DailyOperationsDashboardSummary;
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "amber" | "green";
}) {
  const colorMap = {
    red: "text-red-700",
    amber: "text-amber-700",
    green: "text-green-700",
  };
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${highlight ? colorMap[highlight] : "text-stone-900"}`}>
        {value}
      </p>
    </div>
  );
}

export default function DailyOpsSummaryCard({ summary }: Props) {
  const { latestReport: r } = summary;

  if (!r) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
        <p className="text-sm font-medium text-stone-500">No daily report uploaded yet</p>
        <p className="mt-1 text-xs text-stone-400">
          Upload today&apos;s Toast CSV export to track P&amp;L performance daily.
        </p>
        <Link
          href="/dashboard/operations"
          className="mt-3 inline-block rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-700"
        >
          Upload Daily Ops
        </Link>
      </div>
    );
  }

  const laborHigh = r.labor_cost_percent != null && r.labor_cost_percent > 65;
  const marginLow = r.margin_percent != null && r.margin_percent < 8;

  return (
    <div className="rounded-lg border border-stone-200 bg-white px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-800">
            {formatShortDate(r.report_date)}
          </p>
          <p className="text-xs text-stone-400">{r.source_file_name ?? "Daily Ops"}</p>
        </div>
        <Link
          href={`/dashboard/operations/${r.report_date}`}
          className="text-xs font-medium text-stone-400 hover:text-stone-700"
        >
          Full report →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Sales Net VAT" value={formatCurrency(r.sales_net_vat)} />
        <Metric
          label="Margin"
          value={r.margin_percent != null ? `${r.margin_percent.toFixed(1)}%` : "—"}
          highlight={marginLow ? "red" : undefined}
        />
        <Metric
          label="Labor %"
          value={r.labor_cost_percent != null ? `${r.labor_cost_percent.toFixed(1)}%` : "—"}
          highlight={laborHigh ? "amber" : undefined}
        />
        <Metric label="COGS %" value={r.cogs_percent != null ? `${r.cogs_percent.toFixed(1)}%` : "—"} />
        <Metric label="Guests" value={r.guest_count != null ? String(r.guest_count) : "—"} />
        <Metric label="Checks" value={r.check_count != null ? String(r.check_count) : "—"} />
      </div>

      {(laborHigh || marginLow) && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {laborHigh && <p>⚠ Labor cost is elevated ({r.labor_cost_percent?.toFixed(1)}%)</p>}
          {marginLow && <p>⚠ Margin is below target ({r.margin_percent?.toFixed(1)}%)</p>}
        </div>
      )}
    </div>
  );
}
