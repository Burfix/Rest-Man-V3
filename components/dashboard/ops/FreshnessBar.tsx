/**
 * FreshnessBar — compact labeled row showing last-updated status
 * for each operational data area. Single-line, minimal footprint.
 */

import type { DataFreshnessSummary, FreshnessItem } from "@/services/ops/dataFreshness";

function FreshnessChip({ item }: { item: FreshnessItem }) {
  const label =
    item.daysAgo === null
      ? "—"
      : item.daysAgo === 0
      ? "Today"
      : item.daysAgo === 1
      ? "1d"
      : `${item.daysAgo}d`;

  return (
    <a
      href={item.href}
      title={item.stale ? item.actionLabel : `${item.label}: last updated ${label}`}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium transition-colors hover:bg-stone-100 ${
        item.stale
          ? "border-red-200 text-red-600 bg-red-50"
          : "border-stone-200 text-stone-500 bg-transparent"
      }`}
    >
      <span
        className={`h-1 w-1 rounded-full shrink-0 ${
          item.stale ? "bg-red-400" : "bg-emerald-400"
        }`}
      />
      {item.label} {label}
    </a>
  );
}

interface Props {
  freshness: DataFreshnessSummary;
}

export default function FreshnessBar({ freshness }: Props) {
  const items = [
    freshness.dailyOps,
    freshness.sales,
    freshness.reviews,
    freshness.maintenance,
  ];

  return (
    <div
      aria-label="Data freshness status"
      className="flex items-center gap-2 flex-wrap"
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 shrink-0">
        Freshness
      </span>
      <span className="text-stone-200 text-xs shrink-0">·</span>
      {items.map((item) => (
        <FreshnessChip key={item.label} item={item} />
      ))}
    </div>
  );
}

