/**
 * FreshnessBar — compact labeled row showing last-updated status
 * for each operational data area. Single-line, minimal footprint.
 */

import type { DataFreshnessSummary, FreshnessItem } from "@/services/ops/dataFreshness";

function FreshnessChip({ item, minuteMode }: { item: FreshnessItem; minuteMode?: boolean }) {
  const label =
    item.daysAgo === null
      ? "—"
      : minuteMode
      ? item.daysAgo === 0
        ? "now"
        : `${item.daysAgo}m`
      : item.daysAgo === 0
      ? "Today"
      : item.daysAgo === 1
      ? "1d"
      : `${item.daysAgo}d`;

  return (
    <a
      href={item.href}
      title={item.stale ? item.actionLabel : `${item.label}: last updated ${label}`}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 ${
        item.stale
          ? "border-red-200 text-red-600 bg-red-50"
          : "border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 bg-transparent"
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
  freshness:    DataFreshnessSummary;
  /** True only when deriveMicrosIntegrationStatus returns isLiveDataAvailable=true */
  microsIsLive?: boolean;
}

export default function FreshnessBar({ freshness, microsIsLive = false }: Props) {
  const items: FreshnessItem[] = [
    freshness.dailyOps,
    freshness.sales,
    freshness.reviews,
    freshness.maintenance,
    freshness.stock,
    freshness.compliance,
  ];

  // MICROS chip: only show when live OR configured-but-not-live (so operator can see it's not flowing)
  const showMicrosLive    = microsIsLive;
  const showMicrosOffline = !microsIsLive && freshness.micros.configured;

  return (
    <div
      aria-label="Data freshness status"
      className="flex items-center gap-2 flex-wrap"
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-600 shrink-0">
        Freshness
      </span>
      <span className="text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
      {items.map((item) => (
        <FreshnessChip key={item.label} item={item} />
      ))}

      {/* Live POS chip — only when verified connected */}
      {showMicrosLive && (
        <>
          <span className="text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
          <FreshnessChip item={freshness.micros} minuteMode />
        </>
      )}

      {/* Offline POS chip — shown when MICROS is set up but not currently live */}
      {showMicrosOffline && (
        <>
          <span className="text-stone-200 dark:text-stone-700 text-xs shrink-0">·</span>
          <a
            href="/dashboard/settings/integrations"
            title="POS feed not connected — check integration settings"
            className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-100"
          >
            <span className="h-1 w-1 rounded-full bg-amber-400 shrink-0" />
            No live POS
          </a>
        </>
      )}
    </div>
  );
}

