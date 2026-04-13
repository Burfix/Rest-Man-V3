/**
 * Reviews page — live Google reviews + summary + full log.
 */

import { getAllReviews, getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getPlaceDetails } from "@/lib/google-places";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import type { GoogleSyncResult } from "@/app/api/reviews/google-sync/route";
import { Review, SevenDayReviewSummary } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";
import ReviewActions from "@/components/dashboard/reviews/ReviewActions";
import GoogleReviewsPanel from "@/components/dashboard/reviews/GoogleReviewsPanel";

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
  let googleData: GoogleSyncResult | null = null;
  let googlePlaceId: string | null = null;
  let siteId = "";
  let loadError: string | null = null;

  // ── Auth + site context ───────────────────────────────────────────────────
  try {
    const ctx = await getUserContext();
    siteId = ctx.siteId;
  } catch {
    // Non-fatal — siteId stays empty, Google section won't render
  }

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const fetchGoogle = async (): Promise<GoogleSyncResult | null> => {
    if (!siteId) return null;
    const supabase = createServerClient();
    const { data: site } = await supabase
      .from("sites")
      .select("google_place_id")
      .eq("id", siteId)
      .single();

    googlePlaceId = site?.google_place_id ?? null;

    if (!googlePlaceId) {
      return { connected: false, totalRating: 0, totalCount: 0, reviews: [] };
    }

    const details = await getPlaceDetails(googlePlaceId);
    if (!details) {
      return { connected: false, totalRating: 0, totalCount: 0, reviews: [] };
    }

    return {
      connected: true,
      totalRating: details.rating,
      totalCount: details.user_ratings_total,
      reviews: details.reviews.map((r) => ({
        id: `${googlePlaceId}:${r.time}`,
        rating: r.rating,
        reviewerName: r.author_name || "Anonymous",
        reviewerPhoto: r.profile_photo_url || null,
        text: r.text || "",
        date: r.relative_time_description,
        platform: "google" as const,
      })),
    };
  };

  const [summaryResult, reviewsResult, googleResult] = await Promise.allSettled([
    getSevenDayReviewSummary(),
    getAllReviews(200),
    fetchGoogle(),
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
        <h2 className="mb-3 text-base font-semibold text-stone-900">
          Live Platform Reviews
        </h2>
        <GoogleReviewsPanel
          siteId={siteId}
          placeId={googlePlaceId}
          initialData={googleData}
        />
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

/* ──────────────────────────────────────────────────────────── */

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
