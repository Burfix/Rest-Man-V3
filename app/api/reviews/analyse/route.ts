/**
 * POST /api/reviews/analyse
 *
 * Re-analyse all unanalysed reviews for the current site (last 90 days).
 * Updates sentiment_label, category_tags, urgency, and creates review_actions.
 * Also regenerates a review_insights record for the last 30 days.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { analyseReview, aggregateInsights } from "@/services/reviews/reviewIntelligence";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.RESPOND_TO_REVIEWS, "POST /api/reviews/analyse");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString().split("T")[0];

  try {
    // Fetch reviews without sentiment_label (not yet analysed)
    const { data: unanalysed, error: fetchErr } = await (supabase
      .from("reviews")
      .select("id, rating, rating_scale, review_text")
      .eq("site_id", ctx.siteId)
      .is("sentiment_label", null)
      .gte("review_date", sinceStr) as unknown as Promise<{ data: Array<{ id: string; rating: number; rating_scale: number | null; review_text: string | null }>; error: unknown }>);

    if (fetchErr) throw fetchErr;

    let updated = 0;
    for (const row of unanalysed ?? []) {
      const analysis = analyseReview(
        row.review_text ?? "",
        Number(row.rating),
        Number(row.rating_scale ?? 5),
      );

      const { error: updErr } = await supabase
        .from("reviews")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({
          sentiment_label: analysis.sentimentLabel,
          sentiment:       analysis.sentimentLabel, // keep legacy in sync
          sentiment_score: analysis.sentimentScore,
          category_tags:   analysis.categoryTags,
          urgency:         analysis.urgency,
          review_status:   analysis.suggestedActions.length > 0 ? "action_required" : "new",
          updated_at:      new Date().toISOString(),
        } as any)
        .eq("id", row.id);

      if (updErr) {
        console.error("[analyse] update failed", { id: row.id, updErr });
        continue;
      }

      // Create actions for newly flagged reviews
      if (analysis.suggestedActions.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await supabase.from("review_actions").insert(
          analysis.suggestedActions.map((a) => ({
            site_id:     ctx.siteId,
            review_id:   row.id,
            title:       a.title,
            description: a.description,
            department:  a.department,
            priority:    a.priority,
            status:      "open",
            due_date:    a.dueDays > 0
              ? new Date(Date.now() + a.dueDays * 86_400_000).toISOString().split("T")[0]
              : null,
          })) as any,
        );
      }

      updated++;
    }

    // ── Regenerate 30-day insights ────────────────────────────────────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const periodStart = thirtyDaysAgo.toISOString().split("T")[0];
    const periodEnd   = new Date().toISOString().split("T")[0];

    const { data: allRecent } = await (supabase
      .from("reviews")
      .select("rating, sentiment_label, category_tags, urgency")
      .eq("site_id", ctx.siteId)
      .gte("review_date", periodStart) as unknown as Promise<{ data: Array<{ rating: number; sentiment_label: string | null; category_tags: string[] | null; urgency: string | null }> }>);

    const insights = aggregateInsights(
      (allRecent ?? []).map((r) => ({
        rating:           Number(r.rating),
        sentiment_label:  r.sentiment_label as string,
        category_tags:    r.category_tags as string[],
        urgency:          r.urgency as string,
      })),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("review_insights") as any).upsert(
      {
        site_id:             ctx.siteId,
        period_start:        periodStart,
        period_end:          periodEnd,
        average_rating:      insights.averageRating,
        total_reviews:       insights.totalReviews,
        positive_count:      insights.positiveCount,
        neutral_count:       insights.neutralCount,
        negative_count:      insights.negativeCount,
        top_positive_themes: insights.topPositiveThemes,
        top_negative_themes: insights.topNegativeThemes,
        operational_risks:   insights.operationalRisks,
        recommended_actions: insights.recommendedActions,
        created_at:          new Date().toISOString(),
      },
      { onConflict: "site_id,period_start,period_end" },
    );

    logger.info("Review analysis complete", {
      route:   "POST /api/reviews/analyse",
      siteId:  ctx.siteId,
      updated,
    });

    return NextResponse.json({ updated, insights });
  } catch (err) {
    console.error("[POST /api/reviews/analyse]", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
