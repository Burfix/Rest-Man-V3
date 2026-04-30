/**
 * GET /api/reviews/summary
 *
 * Returns aggregated review intelligence for the current site.
 * Powers the ReviewsSummaryCard and ReviewRiskPanel.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { evaluateReviewRisk } from "@/services/reviews/reviewIntelligence";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/reviews/summary");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const now          = new Date();
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
    const sevenDaysAgo  = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
    const twoDaysAgo    = new Date(now); twoDaysAgo.setDate(now.getDate() - 2);

    const periodStr30  = thirtyDaysAgo.toISOString().split("T")[0];
    const periodStr7   = sevenDaysAgo.toISOString().split("T")[0];
    const twoDaysIso   = twoDaysAgo.toISOString();

    // Parallel queries — all scoped to site_id
    const [
      reviewsResult,
      actionsResult,
      insightsResult,
    ] = await Promise.allSettled([
      supabase
        .from("reviews")
        .select("id, rating, sentiment_label, urgency, review_date, review_status, responded_at, source")
        .eq("site_id", ctx.siteId)
        .gte("review_date", periodStr30)
        .order("review_date", { ascending: false }),

      supabase
        .from("review_actions")
        .select("id, status, priority, department")
        .eq("site_id", ctx.siteId)
        .in("status", ["open", "in_progress"]),

      supabase
        .from("review_insights")
        .select("*")
        .eq("site_id", ctx.siteId)
        .order("period_end", { ascending: false })
        .limit(1)
        .single(),
    ]);

    const reviews      = reviewsResult.status  === "fulfilled" ? ((reviewsResult.value.data ?? []) as unknown as Array<{ id: string; rating: number; sentiment_label: string | null; urgency: string | null; review_date: string; review_status: string | null; responded_at: string | null; source: string | null }>)  : [] as Array<{ id: string; rating: number; sentiment_label: string | null; urgency: string | null; review_date: string; review_status: string | null; responded_at: string | null; source: string | null }>;
    const actions      = actionsResult.status  === "fulfilled" ? ((actionsResult.value.data ?? []) as unknown as Array<{ id: string; status: string; priority: string; department: string }>)  : [] as Array<{ id: string; status: string; priority: string; department: string }>;
    const latestInsight = (insightsResult.status === "fulfilled" ? insightsResult.value.data : null) as { top_negative_themes: string[] | null; top_positive_themes: string[] | null; operational_risks: unknown[] | null } | null;

    // ── Core metrics ──────────────────────────────────────────────────────────
    const totalReviews = reviews.length;
    const avgRating    = totalReviews > 0
      ? Math.round((reviews.reduce((s, r) => s + Number(r.rating), 0) / totalReviews) * 100) / 100
      : 0;

    const positiveCount = reviews.filter((r) => r.sentiment_label === "positive").length;
    const neutralCount  = reviews.filter((r) => r.sentiment_label === "neutral").length;
    const negativeCount = reviews.filter((r) => r.sentiment_label === "negative" || r.sentiment_label === "mixed").length;

    // ── 7-day trend ───────────────────────────────────────────────────────────
    const reviewsLast7 = reviews.filter((r) => r.review_date >= periodStr7);
    const negLast7     = reviewsLast7.filter((r) =>
      r.sentiment_label === "negative" || r.sentiment_label === "mixed",
    ).length;

    // ── Unresolved negative reviews older than 48h ────────────────────────────
    const unresolvedNegOld = reviews.filter((r) => {
      const isNegative = r.sentiment_label === "negative" || Number(r.rating) <= 2;
      const isUnresponded = !r.responded_at && r.review_status !== "responded";
      const isOld = new Date(r.review_date) < twoDaysAgo;
      return isNegative && isUnresponded && isOld;
    }).length;

    // ── Unresolved actions ────────────────────────────────────────────────────
    const unresolvedActionCount = actions.length;
    const criticalActionCount   = actions.filter((a) => a.priority === "critical").length;

    // ── Risk evaluation ───────────────────────────────────────────────────────
    const risk = evaluateReviewRisk(avgRating, negLast7, unresolvedNegOld);

    // ── Top issues / compliments from latest insight ──────────────────────────
    const topIssues      = latestInsight?.top_negative_themes ?? [];
    const topCompliments = latestInsight?.top_positive_themes ?? [];
    const operationalRisks = latestInsight?.operational_risks ?? [];

    // ── Urgent negative reviews (for risk panel) ──────────────────────────────
    const urgentReviews = reviews
      .filter((r) => r.urgency === "critical" || r.urgency === "high")
      .slice(0, 5);

    return NextResponse.json({
      // Core
      averageRating:        avgRating,
      totalReviews,
      positiveCount,
      neutralCount,
      negativeCount,
      // Trend
      reviewsLast7Days:     reviewsLast7.length,
      negativeLast7Days:    negLast7,
      ratingTrend:          negLast7 >= 3 ? "declining" : avgRating >= 4.2 ? "positive" : "stable",
      // Actions
      unresolvedActionCount,
      criticalActionCount,
      unresolvedNegOlder48h: unresolvedNegOld,
      // Themes
      topIssues,
      topCompliments,
      operationalRisks,
      // Risk
      riskLevel:            risk.riskLevel,
      riskDrivers:          risk.drivers,
      // Urgent
      urgentReviews,
    });
  } catch (err) {
    console.error("[GET /api/reviews/summary]", err);
    return NextResponse.json({ error: "Failed to load summary" }, { status: 500 });
  }
}
