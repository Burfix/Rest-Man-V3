/**
 * Reviews page — live Google reviews + summary + full log.
 */

import { getAllReviews, getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getGoogleLiveReviews, GoogleLiveReviews } from "@/services/ops/googleReviews";
import { GoogleReview } from "@/lib/google-places";
import { Review, SevenDayReviewSummary } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";
import ReviewActions from "@/components/dashboard/reviews/ReviewActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const sentimentConfig = {
  positive: "bg-green-50 text-green-700 ring-green-200",
  neutral: "bg-stone-100 text-stone-500 ring-stone-200",
  negative: "bg-red-50 text-red-700 ring-red-200",
} as const;

const platformLabel: Record<string, string> = {
  google: "Google",
  other: "Other",
};

export default async function ReviewsPage() {
  let summary: SevenDayReviewSummary | null = null;
  let reviews: Review[] = [];
  let googleData: GoogleLiveReviews | null = null;
  let loadError: string | null = null;

  // Fetch all three data sources in parallel.
  // Google failures are silently absorbed — the section just hides.
  const [summaryResult, reviewsResult, googleResult] = await Promise.allSettled([
    getSevenDayReviewSummary(),
    getAllReviews(200),
    getGoogleLiveReviews(),
  ]);

  if (summaryResult.status === "fulfilled") summary = summaryResult.value;
  if (reviewsResult.status === "fulfilled") reviews = reviewsResult.value;
  if (googleResult.status === "fulfilled") googleData = googleResult.value;

  if (summaryResult.status === "rejected" || reviewsResult.status === "rejected") {
    loadError = "Failed to load some review data. Showing available results.";
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Reviews</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Customer reputation tracking
        </p>
      </div>

      {/* Manual review entry */}
      <ReviewActions />

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {/* ── Live platform feeds ─────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-stone-900">Live Platform Reviews</h2>
          {googleData && (
            <span className="text-xs text-stone-500 dark:text-stone-400">Google refreshes hourly</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {/* Google Reviews card */}
          {googleData ? (
            <GoogleReviewsCard data={googleData} />
          ) : (
            <GoogleConnectNudge />
          )}
        </div>
      </div>

      {/* ── 7-day Supabase summary ──────────────────────────── */}
      {summary && summary.totalReviews > 0 && (
        <div>
          <h2 className="mb-3 text-base font-semibold text-stone-900">
            7-Day Summary
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard
              label="7-Day Avg"
              value={`${summary.overallAverage} ★`}
              color={
                summary.overallAverage >= 4
                  ? "green"
                  : summary.overallAverage >= 3
                  ? "amber"
                  : "red"
              }
            />
            <SummaryCard
              label="Total Reviews (7d)"
              value={String(summary.totalReviews)}
              color="stone"
            />
            <SummaryCard
              label="Positive"
              value={String(summary.positiveCount)}
              color="green"
            />
            <SummaryCard
              label="Low-rated (≤3)"
              value={String(
                summary.byPlatform.reduce((s, p) => s + p.lowRated, 0)
              )}
              color="red"
            />
          </div>
        </div>
      )}

      {/* ── Full review log (manual DB entries) ─────────────── */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-stone-900">Review Log</h2>
        {reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
            <p className="text-sm font-medium text-stone-500">No reviews recorded yet</p>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              Use the &ldquo;Add Review&rdquo; button above to log a customer review manually.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full divide-y divide-stone-100 bg-white text-sm">
              <thead>
                <tr className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Reviewer</th>
                  <th className="px-4 py-3">Sentiment</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Tags</th>
                  <th className="px-4 py-3">Flagged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reviews.map((r) => (
                  <ReviewRow key={r.id} review={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Google Reviews card
   ──────────────────────────────────────────────────────────── */

function GoogleReviewsCard({ data }: { data: GoogleLiveReviews }) {
  const ratingColor =
    data.overallRating >= 4
      ? "text-green-700"
      : data.overallRating >= 3
      ? "text-amber-700"
      : "text-red-700";

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Google "G" logo colours */}
          <span className="text-sm font-bold">
            <span className="text-[#4285F4]">G</span>
            <span className="text-[#EA4335]">o</span>
            <span className="text-[#FBBC05]">o</span>
            <span className="text-[#4285F4]">g</span>
            <span className="text-[#34A853]">l</span>
            <span className="text-[#EA4335]">e</span>
          </span>
          <span className="text-xs text-stone-500 dark:text-stone-400">Reviews</span>
        </div>
        <div className="text-right">
          <span className={cn("text-xl font-bold", ratingColor)}>
            {data.overallRating.toFixed(1)} ★
          </span>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {data.totalReviews.toLocaleString()} total
          </p>
        </div>
      </div>

      {/* Review list */}
      {data.reviews.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-stone-500 dark:text-stone-400">
          No review text available from Google.
        </p>
      ) : (
        <ul className="divide-y divide-stone-50">
          {data.reviews.map((r) => (
            <GoogleReviewItem key={r.time} review={r} />
          ))}
        </ul>
      )}

      {/* Footer link */}
      <div className="border-t border-stone-100 px-4 py-2.5">
        <a
          href={`https://www.google.com/search?q=si+cantina+sociale+cape+town&si=reviews`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          View all reviews on Google →
        </a>
      </div>
    </div>
  );
}

function GoogleReviewItem({ review }: { review: GoogleReview }) {
  const ratingColor =
    review.rating >= 4
      ? "text-green-700"
      : review.rating >= 3
      ? "text-amber-700"
      : "text-red-700";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {review.profile_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.profile_photo_url}
              alt={review.author_name}
              className="h-7 w-7 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-bold text-stone-500">
              {review.author_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <a
              href={review.author_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-xs font-semibold text-stone-700 hover:underline"
            >
              {review.author_name}
            </a>
            <p className="text-xs text-stone-500 dark:text-stone-400">{review.relative_time_description}</p>
          </div>
        </div>
        <span className={cn("shrink-0 text-sm font-bold", ratingColor)}>
          {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}
        </span>
      </div>
      {review.text && (
        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-stone-600">
          {review.text}
        </p>
      )}
    </li>
  );
}

function GoogleConnectNudge() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-stone-600">Google Reviews</p>
      <p className="mt-1 max-w-xs text-xs text-stone-500 dark:text-stone-400">
        Live Google reviews are not yet configured for this installation.
        Contact your system administrator to enable this feature.
      </p>
    </div>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const sentimentClass =
    review.sentiment && sentimentConfig[review.sentiment]
      ? sentimentConfig[review.sentiment]
      : sentimentConfig.neutral;

  const ratingColor =
    Number(review.rating) >= 4
      ? "text-green-700"
      : Number(review.rating) >= 3
      ? "text-amber-700"
      : "text-red-700";

  return (
    <tr className={cn("hover:bg-stone-50", review.flagged && "bg-red-50 hover:bg-red-50")}>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">
        {formatShortDate(review.review_date)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-medium text-stone-700">
        {platformLabel[review.platform] ?? review.platform}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={cn("font-bold", ratingColor)}>
          {Number(review.rating).toFixed(1)} ★
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-stone-600">
        {review.reviewer_name ?? <span className="text-stone-600 dark:text-stone-300">—</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        {review.sentiment ? (
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize",
              sentimentClass
            )}
          >
            {review.sentiment}
          </span>
        ) : (
          <span className="text-stone-600 dark:text-stone-300">—</span>
        )}
      </td>
      <td className="px-4 py-3 max-w-[280px]">
        <p className="line-clamp-2 text-xs text-stone-600">
          {review.review_text ?? "—"}
        </p>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {(review.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-500"
            >
              {tag}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-center">
        {review.flagged ? (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
            Flagged
          </span>
        ) : (
          <span className="text-stone-600 dark:text-stone-300">—</span>
        )}
      </td>
    </tr>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "green" | "amber" | "red" | "stone";
}) {
  const colorMap = {
    green: "border-green-200 bg-green-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
    stone: "border-stone-200 bg-white",
  };
  const textMap = {
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    stone: "text-stone-800",
  };

  return (
    <div className={cn("rounded-lg border px-4 py-4", colorMap[color])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", textMap[color])}>{value}</p>
    </div>
  );
}
