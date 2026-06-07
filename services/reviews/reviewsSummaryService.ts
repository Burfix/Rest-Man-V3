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

// ── Reply KPI metrics ────────────────────────────────────────────────────────

export interface ReplyMetrics {
  /** Average minutes between review creation and reply_posted_at (last 30d, GMB only) */
  avgResponseMinutes:  number | null;
  /** Human-readable label e.g. "12 min" / "2 hr 4 min" / "—" */
  avgResponseLabel:    string;
  /** % of GMB reviews (last 30d) that have a posted reply */
  replyRatePct:        number;
  /** Count of GMB reviews rated ≤3 with no reply yet */
  awaitingReplyCount:  number;
  /** Qualitative band for the KPI card colour */
  band: "excellent" | "good" | "needs_attention" | "critical" | "no_data";
}

function formatMinutes(mins: number): string {
  if (mins < 60)  return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

export async function getReplyMetrics(siteId: string): Promise<ReplyMetrics> {
  const supabase = createServerClient();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const periodStr = thirtyDaysAgo.toISOString().split("T")[0];

  // Only GMB reviews have gmb_review_name set
  const { data: rows } = await supabase
    .from("reviews")
    .select("rating, gmb_review_name, reply_posted_at, response_time_minutes")
    .eq("site_id", siteId)
    .not("gmb_review_name", "is", null)
    .gte("review_date", periodStr);

  type Row = {
    rating:                  number;
    gmb_review_name:         string;
    reply_posted_at:         string | null;
    response_time_minutes:   number | null;
  };

  const gmbRows = (rows as unknown as Row[] | null) ?? [];

  if (gmbRows.length === 0) {
    return {
      avgResponseMinutes: null,
      avgResponseLabel:   "—",
      replyRatePct:       0,
      awaitingReplyCount: 0,
      band:               "no_data",
    };
  }

  const replied    = gmbRows.filter((r) => r.reply_posted_at !== null);
  const replyTimes = replied
    .map((r) => r.response_time_minutes)
    .filter((m): m is number => m !== null);

  const avgMins = replyTimes.length > 0
    ? replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length
    : null;

  const replyRatePct  = Math.round((replied.length / gmbRows.length) * 100);
  const awaitingCount = gmbRows.filter((r) => r.reply_posted_at === null && Number(r.rating) <= 3).length;

  // Band logic: response time is the primary signal
  let band: ReplyMetrics["band"] = "no_data";
  if (awaitingCount >= 3) {
    band = "critical";
  } else if (avgMins === null) {
    band = "no_data";
  } else if (avgMins <= 30) {
    band = "excellent";
  } else if (avgMins <= 120) {
    band = "good";
  } else if (avgMins <= 480) {
    band = "needs_attention";
  } else {
    band = "critical";
  }

  return {
    avgResponseMinutes: avgMins,
    avgResponseLabel:   avgMins !== null ? formatMinutes(avgMins) : "—",
    replyRatePct,
    awaitingReplyCount: awaitingCount,
    band,
  };
}

