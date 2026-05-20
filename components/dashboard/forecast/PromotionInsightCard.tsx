/**
 * PromotionInsightCard — Active promo impact analysis
 */

"use client";

import { cn } from "@/lib/utils";
import type { PromoInsight } from "@/types/forecast";

export default function PromotionInsightCard({ promos }: { promos: PromoInsight[] }) {
  if (promos.length === 0) {
    return (
      <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
        <Header />
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-3">
          No active promotions or events impacting today&apos;s forecast.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-5">
      <Header />
      <div className="mt-4 space-y-3">
        {promos.map((p, i) => (
          <PromoCard key={i} promo={p} />
        ))}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-purple-50 dark:bg-purple-950/50">
        <span className="text-sm">📣</span>
      </div>
      <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
        Promotion Insight
      </h3>
    </div>
  );
}

function PromoCard({ promo }: { promo: PromoInsight }) {
  return (
    <div className="rounded-lg border border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30 p-3.5 space-y-3">
      <p className="text-xs font-semibold text-stone-800 dark:text-stone-200">
        {promo.promoName}
      </p>

      {/* Impact metrics */}
      <div className="grid grid-cols-3 gap-2">
        <ImpactMetric
          label="Sales Uplift"
          value={`+${promo.expectedSalesUpliftPct}%`}
          positive
        />
        <ImpactMetric
          label="Cover Uplift"
          value={`+${promo.expectedCoverUpliftPct}%`}
          positive
        />
        <ImpactMetric
          label="Margin Impact"
          value={`${promo.expectedMarginImpactPct > 0 ? "+" : ""}${promo.expectedMarginImpactPct}%`}
          positive={promo.expectedMarginImpactPct >= 0}
        />
      </div>

      {/* Recommendation */}
      <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
        {promo.recommendation}
      </p>
    </div>
  );
}

function ImpactMetric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive: boolean;
}) {
  return (
    <div className="rounded-md bg-white dark:bg-stone-800 px-2.5 py-2 text-center">
      <span className="text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-500 block">
        {label}
      </span>
      <span className={cn(
        "text-sm font-bold mt-0.5 block",
        positive
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400",
      )}>
        {value}
      </span>
    </div>
  );
}
