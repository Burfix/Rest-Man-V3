import { SevenDayReviewSummary, Review } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";

interface Props {
  summary: SevenDayReviewSummary;
}

export default function ReviewsSection({ summary }: Props) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-stone-900">
          Last 5 Reviews
        </h2>
        <a
          href="/dashboard/reviews"
          className="text-xs font-medium text-stone-400 hover:text-stone-700"
        >
          All reviews →
        </a>
      </div>

      {summary.totalReviews === 0 ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-6 text-center text-sm text-stone-400">
          No reviews recorded yet.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Platform cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {summary.byPlatform.map((p) => (
              <PlatformCard key={p.platform} stats={p} />
            ))}
          </div>

          {/* Sentiment row */}
          <div className="flex flex-wrap gap-3">
            <SentimentPill
              label="Positive"
              count={summary.positiveCount}
              color="green"
            />
            <SentimentPill
              label="Neutral"
              count={summary.neutralCount}
              color="stone"
            />
            <SentimentPill
              label="Negative"
              count={summary.negativeCount}
              color="red"
            />
            <SentimentPill
              label="Total"
              count={summary.totalReviews}
              color="blue"
            />
          </div>

          {/* Sub-4-star reviews */}
          {summary.flaggedReviews.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-400">
                Under 4 ★ — Needs Attention
              </p>
              <div className="space-y-2">
                {summary.flaggedReviews.map((r) => (
                  <FlaggedReviewRow key={r.id} review={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlatformCard({
  stats,
}: {
  stats: SevenDayReviewSummary["byPlatform"][number];
}) {
  const platformLabel =
    stats.platform === "google"
      ? "Google"
      : stats.platform;

  // Only apply colour when there are actual reviews — never colour a zero
  const ratingColor =
    stats.count === 0
      ? "text-stone-400"
      : stats.averageRating >= 4
      ? "text-green-700"
      : stats.averageRating >= 3
      ? "text-amber-700"
      : "text-red-700";

  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-700">{platformLabel}</p>
        {stats.count === 0 ? (
          <span className="text-xs text-stone-300">No reviews</span>
        ) : (
          <span className={cn("text-xl font-bold", ratingColor)}>
            {stats.averageRating.toFixed(1)}
            <span className="ml-0.5 text-sm font-normal text-stone-400"> / 5</span>
          </span>
        )}
      </div>
      {stats.count > 0 && (
        <div className="mt-2 flex gap-3 text-xs text-stone-500">
          <span>{stats.count} review{stats.count !== 1 ? "s" : ""}</span>
          {stats.lowRated > 0 && (
            <span className="text-red-600 font-medium">
              {stats.lowRated} under 4★
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SentimentPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: "green" | "stone" | "red" | "blue";
}) {
  const colorMap = {
    green: "bg-green-50 text-green-700 ring-green-200",
    stone: "bg-stone-100 text-stone-600 ring-stone-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
        colorMap[color]
      )}
    >
      <span className="font-bold">{count}</span>
      <span>{label}</span>
    </div>
  );
}

function FlaggedReviewRow({ review }: { review: Review }) {
  const ratingColor =
    Number(review.rating) <= 2
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-stone-100 bg-stone-50 px-3 py-3">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold",
          ratingColor
        )}
      >
        {Number(review.rating).toFixed(1)} ★
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold capitalize text-stone-600">
            {review.platform}
          </span>
          <span className="text-xs text-stone-400">
            {formatShortDate(review.review_date)}
          </span>
          {review.reviewer_name && (
            <span className="text-xs text-stone-400">
              · {review.reviewer_name}
            </span>
          )}
        </div>
        {review.review_text && (
          <p className="mt-0.5 line-clamp-2 text-xs text-stone-600">
            {review.review_text}
          </p>
        )}
      </div>
    </div>
  );
}
