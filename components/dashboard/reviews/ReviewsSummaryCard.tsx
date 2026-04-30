/**
 * ReviewsSummaryCard
 *
 * Displays average rating, review count, sentiment split,
 * unresolved actions, and rating trend.
 * Hotel/hospitality grade — executive style.
 */

import { cn } from "@/lib/utils";

type SentimentSplit = {
  positive: number;
  neutral:  number;
  negative: number;
};

type Props = {
  averageRating:     number;
  totalReviews:      number;
  sentiment:         SentimentSplit;
  unresolvedActions: number;
  ratingTrend:       "positive" | "stable" | "declining";
  riskLevel:         "none" | "medium" | "high" | "critical";
};

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const filled = Math.round((rating / max) * 5);
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          className={cn("h-4 w-4", i < filled ? "text-amber-400" : "text-stone-200 dark:text-stone-700")}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

const trendConfig = {
  positive:  { label: "Improving",  icon: "↑", color: "text-emerald-600 dark:text-emerald-400" },
  stable:    { label: "Stable",     icon: "→", color: "text-stone-500" },
  declining: { label: "Declining",  icon: "↓", color: "text-red-600 dark:text-red-400" },
};

const riskBorder = {
  none:     "border-[#e2e2e0] dark:border-stone-800",
  medium:   "border-amber-200 dark:border-amber-900/40",
  high:     "border-orange-200 dark:border-orange-900/40",
  critical: "border-red-300 dark:border-red-900/40",
};

export default function ReviewsSummaryCard({
  averageRating,
  totalReviews,
  sentiment,
  unresolvedActions,
  ratingTrend,
  riskLevel,
}: Props) {
  const trend = trendConfig[ratingTrend];
  const total = sentiment.positive + sentiment.neutral + sentiment.negative || 1;
  const posPct = Math.round((sentiment.positive / total) * 100);
  const neuPct = Math.round((sentiment.neutral  / total) * 100);
  const negPct = Math.round((sentiment.negative / total) * 100);

  return (
    <div className={cn("border p-5 bg-white dark:bg-[#0f0f0f] space-y-4", riskBorder[riskLevel])}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.2em] font-medium text-stone-600">
          GUEST EXPERIENCE
        </span>
        {unresolvedActions > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/30 px-2 py-0.5 text-[9px] font-mono font-bold text-red-600 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/40">
            {unresolvedActions} ACTION{unresolvedActions !== 1 ? "S" : ""}
          </span>
        )}
      </div>

      {/* Rating */}
      <div className="flex items-end gap-3">
        <div>
          <span className="text-4xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">
            {averageRating.toFixed(1)}
          </span>
          <span className="ml-1 text-sm text-stone-400">/5</span>
        </div>
        <div className="pb-1 space-y-1">
          <StarRating rating={averageRating} />
          <p className="text-[10px] text-stone-500 font-mono">{totalReviews} reviews (30d)</p>
        </div>
      </div>

      {/* Trend */}
      <div className="flex items-center gap-1.5">
        <span className={cn("text-[11px] font-mono font-bold", trend.color)}>
          {trend.icon} {trend.label}
        </span>
      </div>

      {/* Sentiment bar */}
      <div className="space-y-1.5">
        <div className="flex w-full h-2 overflow-hidden rounded-full">
          <div className="bg-emerald-500 transition-all" style={{ width: `${posPct}%` }} />
          <div className="bg-stone-300 dark:bg-stone-600 transition-all" style={{ width: `${neuPct}%` }} />
          <div className="bg-red-400 transition-all" style={{ width: `${negPct}%` }} />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-stone-500">
          <span className="text-emerald-600 dark:text-emerald-400">{sentiment.positive} positive</span>
          <span>{sentiment.neutral} neutral</span>
          <span className="text-red-500">{sentiment.negative} negative</span>
        </div>
      </div>
    </div>
  );
}
