/* eslint-disable camelcase */
/**
 * POST /api/reviews/reply
 *
 * Posts an approved reply to a Google review via the Business Profile
 * Reviews API, then stamps reply_posted_at on the reviews row.
 *
 * Body: { review_id: uuid, reply_text: string }
 *
 * Required: PERMISSIONS.RESPOND_TO_REVIEWS
 *
 * The GM calls this after approving the AI draft (or editing it).
 * On success the review card UI updates to show "Replied" state.
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import { apiGuard }                  from "@/lib/auth/api-guard";
import { getValidGmbToken }          from "@/lib/gmb/token";
import { getServiceRoleClient }      from "@/lib/supabase/service-role-client";
import { PERMISSIONS }               from "@/lib/rbac/roles";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const replySchema = z.object({
  review_id:  z.string().uuid(),
  reply_text: z.string().min(1).max(4096),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(
    PERMISSIONS.RESPOND_TO_REVIEWS,
    "POST /api/reviews/reply",
  );
  if (guard.error) return guard.error;

  const { ctx } = guard;

  // ── Parse and validate body ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { review_id, reply_text } = parsed.data;

  // ── Fetch the review — must belong to this site (tenant isolation) ─────────
  const db = getServiceRoleClient();

  const { data: review, error: fetchErr } = await db
    .from("reviews")
    .select("id, site_id, gmb_review_name, reply_posted_at")
    .eq("id", review_id)
    .eq("site_id", ctx.siteId)
    .single<{
      id:               string;
      site_id:          string;
      gmb_review_name:  string | null;
      reply_posted_at:  string | null;
    }>();

  if (fetchErr || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (!review.gmb_review_name) {
    return NextResponse.json(
      { error: "This review was not imported from Google My Business — GMB reply not available." },
      { status: 409 },
    );
  }

  if (review.reply_posted_at) {
    return NextResponse.json(
      { error: "A reply has already been posted for this review." },
      { status: 409 },
    );
  }

  // ── Get a valid GMB access token for this site ────────────────────────────
  const accessToken = await getValidGmbToken(ctx.siteId);
  if (!accessToken) {
    return NextResponse.json(
      { error: "Google My Business is not connected for this site. Connect it in Settings → Integrations." },
      { status: 424 }, // 424 Failed Dependency
    );
  }

  // ── Post reply to Business Profile API ───────────────────────────────────
  // reviewName format: "accounts/{id}/locations/{id}/reviews/{id}"
  const replyUrl = `https://mybusinessreviews.googleapis.com/v1/${review.gmb_review_name}/reply`;

  const gmbRes = await fetch(replyUrl, {
    method:  "PUT",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body:    JSON.stringify({ comment: reply_text }),
    cache:   "no-store",
  });

  if (!gmbRes.ok) {
    const errBody = await gmbRes.text().catch(() => "");
    logger.error("gmb.reply: Business Profile API error", {
      siteId:     ctx.siteId,
      reviewId:   review_id,
      status:     gmbRes.status,
      body:       errBody.slice(0, 300),
    });
    return NextResponse.json(
      { error: "Failed to post reply to Google. Please try again." },
      { status: 502 },
    );
  }

  // ── Stamp reply_posted_at and save the posted reply text ─────────────────
  const now = new Date().toISOString();

  const { error: updateErr } = await db
    .from("reviews")
    .update({
      reply_posted_at: now,
      response_text:   reply_text,
      updated_at:      now,
    })
    .eq("id", review_id);

  if (updateErr) {
    // Reply was posted successfully but DB update failed — log for ops, don't
    // return 500 to the client (the reply IS live on Google).
    logger.error("gmb.reply: DB stamp failed after successful post", {
      siteId:   ctx.siteId,
      reviewId: review_id,
      error:    updateErr.message,
    });
  }

  logger.info("gmb.reply: reply posted", {
    siteId:   ctx.siteId,
    reviewId: review_id,
  });

  return NextResponse.json({
    ok:              true,
    reply_posted_at: now,
  });
}
