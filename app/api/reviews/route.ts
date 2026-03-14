/**
 * POST /api/reviews
 *
 * Body (JSON):
 *   { platform, review_date, rating, reviewer_name?, review_text?, sentiment? }
 *
 * Returns: { review: Review }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      platform,
      review_date,
      rating,
      reviewer_name,
      review_text,
      sentiment,
    } = body as {
      platform?: string;
      review_date?: string;
      rating?: number | string;
      reviewer_name?: string;
      review_text?: string;
      sentiment?: string;
    };

    const validPlatforms = ["google", "other"];
    if (!platform || !validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: `platform must be one of: ${validPlatforms.join(", ")}` },
        { status: 400 }
      );
    }

    if (!review_date) {
      return NextResponse.json({ error: "review_date is required." }, { status: 400 });
    }

    const ratingNum = typeof rating === "string" ? parseInt(rating, 10) : rating;
    if (!ratingNum || ratingNum < 1 || ratingNum > 5 || isNaN(ratingNum)) {
      return NextResponse.json(
        { error: "rating must be a number between 1 and 5." },
        { status: 400 }
      );
    }

    const validSentiments = ["positive", "neutral", "negative"];
    if (sentiment && !validSentiments.includes(sentiment)) {
      return NextResponse.json(
        { error: `sentiment must be one of: ${validSentiments.join(", ")}` },
        { status: 400 }
      );
    }

    // Auto-infer sentiment from rating if not provided
    const inferredSentiment =
      sentiment ||
      (ratingNum >= 4 ? "positive" : ratingNum === 3 ? "neutral" : "negative");

    const supabase = createServerClient();

    const { data: review, error } = await supabase
      .from("reviews")
      .insert({
        platform,
        review_date,
        rating: ratingNum,
        reviewer_name: reviewer_name?.trim() || null,
        review_text: review_text?.trim() || null,
        sentiment: inferredSentiment,
        tags: [],
        flagged: ratingNum < 4,  // auto-flag anything under 4 stars
      })
      .select()
      .single();

    if (error || !review) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to add review." },
        { status: 500 }
      );
    }

    return NextResponse.json({ review }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
