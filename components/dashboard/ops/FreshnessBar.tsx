/**
 * FreshnessBar — compact horizontal strip showing last-updated status
 * for each operational data area. Renders in the dashboard header area.
 */

import type { DataFreshnessSummary, FreshnessItem } from "@/services/ops/dataFreshness";

function FreshnessChip({ item }: { item: FreshnessItem }) {
  const label =
    item.daysAgo === null
      ? "Never"
      : item.daysAgo === 0
      ? "Today"
      : item.daysAgo === 1
      ? "Yesterday"
      : `${item.daysAgo}d ago`;

  return (
    <a
      href={item.href}
      title={item.stale ? item.actionLabel : `${item.label}: last updated ${label}`}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80 sm:px-2.5 sm:py-1 sm:text-xs ${
        item.stale
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-green-200 bg-green-50 text-green-700"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          item.stale ? "bg-red-400" : "bg-green-400"
        }`}
      />
      {item.label}: {label}
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
      className="flex flex-wrap gap-2"
    >
      {items.map((item) => (
        <FreshnessChip key={item.label} item={item} />
      ))}
    </div>
  );
}
