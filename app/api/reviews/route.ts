import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createReviewSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RESPOND_TO_REVIEWS, "POST /api/reviews");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createReviewSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const inferredSentiment = d.sentiment || (d.rating >= 4 ? "positive" : d.rating === 3 ? "neutral" : "negative");

    const { data: review, error } = await supabase
      .from("reviews")
      .insert({
        site_id: ctx.siteId,
        platform: d.platform,
        review_date: d.review_date,
        rating: d.rating,
        reviewer_name: d.reviewer_name?.trim() || null,
        review_text: d.review_text?.trim() || null,
        sentiment: inferredSentiment,
        tags: [],
        flagged: d.rating < 4,
      })
      .select()
      .single();

    if (error) throw error;
    logger.info("Review created", { route: "POST /api/reviews", siteId: ctx.siteId });
    return NextResponse.json({ review }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create review", { route: "POST /api/reviews", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
