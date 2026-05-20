/**
 * GET /api/reviews
 *
 * Returns reviews for the authenticated user's site.
 * Supports query params: source, sentiment, status, urgency, from, to
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/reviews");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const { searchParams } = new URL(req.url);
  const source    = searchParams.get("source");
  const sentiment = searchParams.get("sentiment");
  const status    = searchParams.get("status");
  const urgency   = searchParams.get("urgency");
  const from      = searchParams.get("from");
  const to        = searchParams.get("to");

  try {
    let query = supabase
      .from("reviews")
      .select("*")
      .eq("site_id", ctx.siteId)
      .order("review_date", { ascending: false });

    if (source)    query = query.eq("source", source);
    if (sentiment) query = query.eq("sentiment_label", sentiment);
    if (status)    query = query.eq("review_status", status);
    if (urgency)   query = query.eq("urgency", urgency);
    if (from)      query = query.gte("review_date", from);
    if (to)        query = query.lte("review_date", to);

    const { data, error } = await query.limit(200);
    if (error) throw error;

    return NextResponse.json({ reviews: data ?? [] });
  } catch (err) {
    console.error("[GET /api/reviews]", err);
    return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
  }
}
