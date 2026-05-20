/**
 * POST /api/reviews/manual
 *
 * Upload a manual/imported review for the authenticated user's site.
 * Source defaults to "manual". Validates with Zod.
 * Runs analysis immediately after insert.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { analyseReview } from "@/services/reviews/reviewIntelligence";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const manualReviewSchema = z.object({
  source:       z.enum(["google", "booking_com", "tripadvisor", "airbnb", "manual"]).default("manual"),
  guest_name:   z.string().max(200).optional().nullable(),
  rating:       z.number().min(0.5).max(10),
  rating_scale: z.number().min(1).max(10).default(5),
  review_text:  z.string().min(1).max(10_000),
  review_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  external_review_id: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RESPOND_TO_REVIEWS, "POST /api/reviews/manual");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const parsed = manualReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 },
      );
    }
    const d = parsed.data;

    // Run analysis immediately
    const analysis = analyseReview(d.review_text, d.rating, d.rating_scale);

    const { data: review, error } = await (supabase
      .from("reviews")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({
        site_id:            ctx.siteId,
        source:             d.source,
        platform:           d.source, // keep legacy column in sync
        external_id:        d.external_review_id ?? null,
        reviewer_name:      d.guest_name?.trim() ?? null,
        rating:             d.rating,
        rating_scale:       d.rating_scale,
        review_text:        d.review_text.trim(),
        review_date:        d.review_date,
        sentiment:          analysis.sentimentLabel,   // legacy column
        sentiment_label:    analysis.sentimentLabel,
        sentiment_score:    analysis.sentimentScore,
        category_tags:      analysis.categoryTags,
        urgency:            analysis.urgency,
        review_status:      analysis.suggestedActions.length > 0 ? "action_required" : "new",
        tags:               [],
        flagged:            d.rating < d.rating_scale * 0.7,
      } as any)
      .select()
      .single() as unknown as Promise<{ data: { id: string } | null; error: unknown }>);

    if (error) throw error;
    if (analysis.suggestedActions.length > 0 && review) {
      const actionRows = analysis.suggestedActions.map((a) => ({
        site_id:     ctx.siteId,
        review_id:   review.id,
        title:       a.title,
        description: a.description,
        department:  a.department,
        priority:    a.priority,
        status:      "open" as const,
        due_date:    a.dueDays > 0
          ? new Date(Date.now() + a.dueDays * 86_400_000).toISOString().split("T")[0]
          : null,
      }));

      const { error: actionErr } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("review_actions")
        .insert(actionRows as any);

      if (actionErr) {
        console.error("[POST /api/reviews/manual] action insert failed", actionErr);
      }
    }

    logger.info("Manual review created", {
      route:    "POST /api/reviews/manual",
      siteId:   ctx.siteId,
      source:   d.source,
      urgency:  analysis.urgency,
      actions:  analysis.suggestedActions.length,
    });

    return NextResponse.json({ review, analysis }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/reviews/manual]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
