/**
 * POST /api/reviews/respond
 *
 * Generates a professional response draft for a specific review.
 * Saves draft to response_text only — does NOT auto-post publicly.
 * The draft can be copied by the GM and posted manually.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { generateResponseDraft } from "@/services/reviews/reviewIntelligence";
import type { SentimentLabel } from "@/services/reviews/reviewIntelligence";

export const dynamic = "force-dynamic";

const respondSchema = z.object({
  review_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RESPOND_TO_REVIEWS, "POST /api/reviews/respond");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 },
      );
    }

    // Fetch the review — must belong to this site
    const { data: review, error: fetchErr } = await (supabase
      .from("reviews")
      .select("id, reviewer_name, rating, rating_scale, review_text, sentiment_label, site_id")
      .eq("id", parsed.data.review_id)
      .eq("site_id", ctx.siteId) // tenant isolation enforced
      .single() as unknown as Promise<{ data: { id: string; reviewer_name: string | null; rating: number; rating_scale: number | null; review_text: string | null; sentiment_label: string | null; site_id: string } | null; error: unknown }>);

    if (fetchErr || !review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // Generate draft
    const draft = generateResponseDraft({
      guestName:      review.reviewer_name as string | null,
      rating:         Number(review.rating),
      ratingScale:    Number(review.rating_scale ?? 5),
      reviewText:     review.review_text ?? "",
      sentimentLabel: review.sentiment_label as SentimentLabel | null,
    });

    // Save draft response_text (not published)
    const { error: updateErr } = await supabase
      .from("reviews")
      .update({ response_text: draft, updated_at: new Date().toISOString() })
      .eq("id", review.id);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      review_id: review.id,
      draft,
      note: "Draft saved. Review and post manually on the platform before publishing.",
    });
  } catch (err) {
    console.error("[POST /api/reviews/respond]", err);
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
