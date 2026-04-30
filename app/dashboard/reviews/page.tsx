/**
 * Reviews page — Guest Experience Intelligence + platform feeds + full log.
 */

import { getAllReviews, getSevenDayReviewSummary } from "@/services/ops/reviewsSummary";
import { getReviewSummaryForSite } from "@/services/reviews/reviewsSummaryService";
import { getPlaceDetails } from "@/lib/google-places";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import type { GoogleSyncResult } from "@/app/api/reviews/google-sync/route";
import { Review, SevenDayReviewSummary } from "@/types";
import { cn, formatShortDate } from "@/lib/utils";
import ReviewActions from "@/components/dashboard/reviews/ReviewActions";
import GoogleReviewsPanel from "@/components/dashboard/reviews/GoogleReviewsPanel";
import ReviewsSummaryCard from "@/components/dashboard/reviews/ReviewsSummaryCard";
import ReviewRiskPanel from "@/components/dashboard/reviews/ReviewRiskPanel";
import GuestVoiceFeed from "@/components/dashboard/reviews/GuestVoiceFeed";
import ReviewActionsPanel from "@/components/dashboard/reviews/ReviewActionsPanel";

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
  let reviewActions: Array<{ id: string; title: string; description?: string | null; department: string; priority: string; status: string; due_date?: string | null }> = [];
  let intelligenceSummary: Awaited<ReturnType<typeof getReviewSummaryForSite>> | null = null;

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

  const [summaryResult, reviewsResult, googleResult, actionsResult, intelligenceResult] = await Promise.allSettled([
    getSevenDayReviewSummary(siteId),
    getAllReviews(200, siteId),
    fetchGoogle(),
    siteId
      ? createServerClient()
          .from("review_actions")
          .select("id, title, description, department, priority, status, due_date")
          .eq("site_id", siteId)
          .in("status", ["open", "in_progress"])
          .order("priority")
      : Promise.resolve({ data: [] }),
    siteId ? getReviewSummaryForSite(siteId) : Promise.resolve(null),
  ]);

  if (summaryResult.status === "fulfilled") summary = summaryResult.value;
  if (reviewsResult.status === "fulfilled") reviews = reviewsResult.value;
  if (googleResult.status === "fulfilled") googleData = googleResult.value;
  if (actionsResult.status === "fulfilled") reviewActions = (actionsResult.value as { data: typeof reviewActions }).data ?? [];
  if (intelligenceResult.status === "fulfilled") intelligenceSummary = intelligenceResult.value;

  if (summaryResult.status === "rejected" || reviewsResult.status === "rejected") {
    loadError = "Failed to load some review data. Showing available results.";
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Guest Experience Intelligence</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Reviews · Sentiment · Operational risks · Response management
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {/* ── Intelligence panels ─────────────────────────────── */}
      {intelligenceSummary && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: summary card */}
          <ReviewsSummaryCard
            averageRating={intelligenceSummary.averageRating}
            totalReviews={intelligenceSummary.totalReviews}
            sentiment={{
              positive: intelligenceSummary.positiveCount,
              neutral:  intelligenceSummary.neutralCount,
              negative: intelligenceSummary.negativeCount,
            }}
            unresolvedActions={intelligenceSummary.unresolvedActions}
            ratingTrend={
              intelligenceSummary.riskLevel === "critical" || intelligenceSummary.negativeLast7 >= 3
                ? "declining"
                : intelligenceSummary.averageRating >= 4.3
                ? "positive"
                : "stable"
            }
            riskLevel={intelligenceSummary.riskLevel}
          />

          {/* Middle: risk panel */}
          <ReviewRiskPanel
            riskLevel={intelligenceSummary.riskLevel}
            riskDrivers={intelligenceSummary.riskDrivers}
            operationalRisks={[]}
            urgentReviews={reviews.filter((r) => {
              const rating = Number(r.rating);
              return rating <= 3 || (r as unknown as { urgency?: string }).urgency === "critical";
            }).slice(0, 3).map((r) => ({
              id:            r.id,
              reviewer_name: r.reviewer_name,
              rating:        Number(r.rating),
              review_date:   r.review_date,
              review_text:   r.review_text,
              urgency:       (r as unknown as { urgency?: string }).urgency,
              source:        (r as unknown as { source?: string }).source,
            }))}
          />

          {/* Right: actions panel */}
          <ReviewActionsPanel actions={reviewActions} />
        </div>
      )}

      {/* ── Guest Voice Feed ────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          Guest Voice
        </h2>
        <GuestVoiceFeed reviews={reviews.map((r) => ({
          id:              r.id,
          reviewer_name:   r.reviewer_name,
          rating:          Number(r.rating),
          rating_scale:    5,
          review_date:     r.review_date,
          review_text:     r.review_text,
          source:          (r as unknown as { source?: string }).source ?? r.platform,
          sentiment_label: (r as unknown as { sentiment_label?: string }).sentiment_label ?? r.sentiment,
          category_tags:   (r as unknown as { category_tags?: string[] }).category_tags ?? r.tags,
          review_status:   (r as unknown as { review_status?: string }).review_status,
          urgency:         (r as unknown as { urgency?: string }).urgency,
        }))} />
      </div>

      {/* ── Manual review entry ─────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
          Import / Add Review
        </h2>
        <ReviewActions />
      </div>

      {/* ── Live platform feeds ─────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
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
          <h2 className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
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
