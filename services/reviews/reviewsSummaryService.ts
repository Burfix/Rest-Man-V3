/**
 * services/reviews/reviewsSummaryService.ts
 *
 * Site-aware review summary service for the operating engine.
 * Used by: Operating Score, GM Co-Pilot, Alert signals, Head Office.
 *
 * All queries are scoped to siteId — never leaks between sites.
 */

import { createServerClient } from "@/lib/supabase/server";
import {
  aggregateInsights,
  evaluateReviewRisk,
  type ReviewInsightData,
} from "./reviewIntelligence";

export interface ReviewSummary {
  siteId:            string;
  totalReviews:      number;
  averageRating:     number;
  positiveCount:     number;
  neutralCount:      number;
  negativeCount:     number;
  negativeLast7:     number;
  unresolvedNegOld:  number;        // unresponded negatives older than 48h
  unresolvedActions: number;
  riskLevel:         "none" | "medium" | "high" | "critical";
  riskDrivers:       string[];
  topNegativeThemes: string[];
  topPositiveThemes: string[];
  // GM Co-Pilot suggested actions
  copilotActions:    string[];
}

export async function getReviewSummaryForSite(siteId: string): Promise<ReviewSummary> {
  const supabase = createServerClient();

  const now           = new Date();
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
  const sevenDaysAgo  = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
  const twoDaysAgo    = new Date(now); twoDaysAgo.setDate(now.getDate() - 2);

  const periodStr30 = thirtyDaysAgo.toISOString().split("T")[0];
  const periodStr7  = sevenDaysAgo.toISOString().split("T")[0];

  const [reviewsResult, actionsResult] = await Promise.allSettled([
    supabase
      .from("reviews")
      .select("id, rating, rating_scale, review_text, sentiment_label, category_tags, urgency, review_date, review_status, responded_at")
      .eq("site_id", siteId)
      .gte("review_date", periodStr30),

    supabase
      .from("review_actions")
      .select("id, status, priority")
      .eq("site_id", siteId)
      .in("status", ["open", "in_progress"]),
  ]);

  type ReviewRow = { id: string; rating: number; rating_scale: number | null; review_text: string | null; sentiment_label: string | null; category_tags: string[] | null; urgency: string | null; review_date: string; review_status: string | null; responded_at: string | null };
  type ActionRow = { id: string; status: string; priority: string };
  const reviews  = reviewsResult.status  === "fulfilled" ? ((reviewsResult.value.data ?? []) as unknown as ReviewRow[])  : [] as ReviewRow[];
  const actions  = actionsResult.status  === "fulfilled" ? ((actionsResult.value.data ?? []) as unknown as ActionRow[])  : [] as ActionRow[];

  // Aggregate insights
  const insights = aggregateInsights(
    reviews.map((r) => ({
      rating:          Number(r.rating),
      sentiment_label: r.sentiment_label as string,
      category_tags:   r.category_tags as string[],
    })),
  );

  // 7-day negative count
  const negativeLast7 = reviews.filter(
    (r) => r.review_date >= periodStr7 &&
      (r.sentiment_label === "negative" || r.sentiment_label === "mixed"),
  ).length;

  // Unresponded negatives older than 48h
  const unresolvedNegOld = reviews.filter((r) => {
    const isNeg    = r.sentiment_label === "negative" || Number(r.rating) <= 2;
    const isUnresp = !r.responded_at && r.review_status !== "responded";
    const isOld    = new Date(r.review_date) < twoDaysAgo;
    return isNeg && isUnresp && isOld;
  }).length;

  const unresolvedActions = actions.length;

  const risk = evaluateReviewRisk(
    insights.averageRating,
    negativeLast7,
    unresolvedNegOld,
  );

  // ── GM Co-Pilot actions ────────────────────────────────────────────────────
  const copilotActions: string[] = [];

  if (unresolvedNegOld > 0) {
    copilotActions.push(
      `Protect rating: ${unresolvedNegOld} unresolved negative review${unresolvedNegOld > 1 ? "s" : ""} older than 48 hours`,
    );
  }

  if (insights.topNegativeThemes.includes("cleanliness")) {
    copilotActions.push("Housekeeping audit required: cleanliness mentioned in recent reviews");
  }

  if (insights.topNegativeThemes.includes("maintenance")) {
    copilotActions.push("Maintenance risk: equipment/plumbing issue mentioned by guest");
  }

  if (insights.topNegativeThemes.includes("staff") || insights.topNegativeThemes.includes("service")) {
    copilotActions.push("Service quality flag: staff/service issue raised in recent reviews");
  }

  if (negativeLast7 >= 3) {
    copilotActions.push(`Critical trend: ${negativeLast7} negative reviews in last 7 days — escalate to management`);
  }

  // Find unresponded booking.com / Google negatives (respond before COB)
  const urgentUnresponded = reviews.find(
    (r) =>
      (r.sentiment_label === "negative" || Number(r.rating) <= 3) &&
      !r.responded_at &&
      r.review_status !== "responded",
  );
  if (urgentUnresponded) {
    const sourceName = (urgentUnresponded as unknown as { source?: string }).source;
    const displaySource = sourceName === "booking_com" ? "Booking.com"
      : sourceName ? sourceName.charAt(0).toUpperCase() + sourceName.slice(1)
      : "guest platform";
    copilotActions.push(`Respond to negative ${displaySource} review before close of business`);
  }

  return {
    siteId,
    totalReviews:      insights.totalReviews,
    averageRating:     insights.averageRating,
    positiveCount:     insights.positiveCount,
    neutralCount:      insights.neutralCount,
    negativeCount:     insights.negativeCount,
    negativeLast7,
    unresolvedNegOld,
    unresolvedActions,
    riskLevel:         risk.riskLevel,
    riskDrivers:       risk.drivers,
    topNegativeThemes: insights.topNegativeThemes,
    topPositiveThemes: insights.topPositiveThemes,
    copilotActions,
  };
}
