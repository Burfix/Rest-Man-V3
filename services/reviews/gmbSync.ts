/* eslint-disable camelcase */
/**
 * services/reviews/gmbSync.ts
 *
 * Google My Business (Business Profile API) review sync.
 *
 * Unlike googleSync.ts (which uses the Places API for public star ratings),
 * this service authenticates with the stored OAuth token to:
 *   1. Fetch ALL reviews from the Business Profile Reviews API
 *   2. Upsert reviews with gmb_review_name (required for posting replies)
 *   3. Generate AI draft replies for new reviews
 *   4. Send WhatsApp alerts to eligible GMs for reviews rated ≤ 3 stars
 *   5. Log every sync run to gmb_review_sync_log
 *
 * Called from:
 *   - app/api/reviews/google-sync/route.ts  (cron path: siteId=ALL)
 *   - app/api/reviews/gmb-sync/route.ts     (manual per-site trigger)
 *
 * Requires env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  (for token refresh)
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN (for alerts)
 *   NEXT_PUBLIC_SITE_URL (for deep-link in alert message)
 */

import { getServiceRoleClient }                     from "@/lib/supabase/service-role-client";
import { getGmbTokenRow }                           from "@/lib/gmb/token";
import { generateResponseDraft }                    from "@/services/reviews/reviewIntelligence";
import { sendWhatsAppMessage }                      from "@/services/whatsapp/client";
import { logger }                                   from "@/lib/logger";

// ── Business Profile API types ────────────────────────────────────────────────

type GmbStarRating = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";

interface GmbReviewer {
  profilePhotoUrl?: string;
  displayName:      string;
  isAnonymous?:     boolean;
}

interface GmbReviewReply {
  comment:    string;
  updateTime: string;
}

interface GmbReview {
  name:         string;   // "accounts/{id}/locations/{id}/reviews/{id}"
  reviewId:     string;
  reviewer:     GmbReviewer;
  starRating:   GmbStarRating;
  comment?:     string;
  createTime:   string;   // ISO 8601
  updateTime:   string;
  reviewReply?: GmbReviewReply;
}

interface GmbReviewsListResponse {
  reviews?:         GmbReview[];
  averageRating?:   number;
  totalReviewCount?: number;
  nextPageToken?:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAR_TO_NUM: Record<GmbStarRating, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

/**
 * Fetch all reviews for a location (handles pagination).
 */
async function fetchAllGmbReviews(
  accessToken: string,
  locationName: string,
): Promise<GmbReview[]> {
  const base    = "https://mybusinessreviews.googleapis.com/v1";
  const reviews: GmbReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${base}/${locationName}/reviews`);
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache:   "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error("gmb.sync: reviews API error", {
        status:   res.status,
        location: locationName,
        body:     body.slice(0, 300),
      });
      break;
    }

    const data = (await res.json()) as GmbReviewsListResponse;
    reviews.push(...(data.reviews ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return reviews;
}

/**
 * Fetch active GM contacts for a site to send WhatsApp alerts.
 */
async function getGmContacts(siteId: string): Promise<{ name: string; phone_whatsapp: string }[]> {
  const db = getServiceRoleClient();

  const { data } = await db
    .from("manager_contacts")
    .select("name, phone_whatsapp, alert_preferences")
    .eq("site_id", siteId)
    .eq("is_active", true);

  if (!data) return [];

  // Only send to contacts who haven't explicitly disabled custom alerts
  return (data as { name: string; phone_whatsapp: string; alert_preferences: Record<string, boolean> | null }[])
    .filter((m) => m.phone_whatsapp && m.alert_preferences?.custom !== false)
    .map((m) => ({ name: m.name, phone_whatsapp: m.phone_whatsapp }));
}

/**
 * Build the WhatsApp alert message for a new low-rated review.
 * Kept tight — WA preview truncates at ~320 chars.
 */
function buildReviewAlertMessage(params: {
  siteName:   string;
  rating:     number;
  reviewer:   string;
  reviewText: string;
  draft:      string;
  reviewUrl:  string;
}): string {
  const stars  = "⭐".repeat(params.rating);
  const snippet = params.reviewText.length > 100
    ? params.reviewText.slice(0, 97) + "…"
    : params.reviewText;

  return [
    `${stars} New ${params.rating}-star review — ${params.siteName}`,
    `👤 ${params.reviewer}: "${snippet}"`,
    ``,
    `💬 Draft reply ready:`,
    `"${params.draft.slice(0, 200)}${params.draft.length > 200 ? "…" : ""}"`,
    ``,
    `✅ Approve & post: ${params.reviewUrl}`,
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GmbSyncResult {
  siteId:      string;
  outcome:     "success" | "no_token" | "error";
  newReviews:  number;
  errorMessage?: string;
}

/**
 * Sync GMB reviews for a single site.
 *
 * - Fetches reviews via Business Profile API using the stored OAuth token
 * - Upserts into reviews table with gmb_review_name for reply correlation
 * - Generates AI draft replies and saves to ai_reply_draft
 * - Sends WhatsApp alerts for new reviews rated ≤ 3 stars
 * - Logs outcome to gmb_review_sync_log
 */
export async function syncSiteGmbReviews(siteId: string): Promise<GmbSyncResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getServiceRoleClient() as any;

  // ── 1. Get valid token and location ──────────────────────────────────────────
  const tokenRow = await getGmbTokenRow(siteId);

  if (!tokenRow || !tokenRow.gmb_location_id) {
    await logSync(db, siteId, 0, "no_token", "No GMB token or location ID configured");
    return { siteId, outcome: "no_token", newReviews: 0 };
  }

  const { access_token, gmb_location_id } = tokenRow;

  // ── 2. Fetch site name for alert messages ─────────────────────────────────
  const { data: siteRowRaw } = await db
    .from("sites")
    .select("name")
    .eq("id", siteId)
    .single();
  const siteRow = siteRowRaw as { name: string } | null;

  const siteName = siteRow?.name ?? siteId;

  // ── 3. Fetch reviews from GMB ─────────────────────────────────────────────
  let gmbReviews: GmbReview[];
  try {
    gmbReviews = await fetchAllGmbReviews(access_token, gmb_location_id);
  } catch (err) {
    logger.error("gmb.sync: fetch failed", { siteId, err });
    await logSync(db, siteId, 0, "error", String(err));
    return { siteId, outcome: "error", newReviews: 0, errorMessage: String(err) };
  }

  if (!gmbReviews.length) {
    await logSync(db, siteId, 0, "success");
    return { siteId, outcome: "success", newReviews: 0 };
  }

  // ── 4. Collect existing gmb_review_names to detect truly new reviews ───────
  const { data: existing } = await db
    .from("reviews")
    .select("gmb_review_name")
    .eq("site_id", siteId)
    .not("gmb_review_name", "is", null);

  const knownNames = new Set((existing ?? []).map((r: { gmb_review_name: string }) => r.gmb_review_name));

  // ── 5. Upsert reviews and process new ones ────────────────────────────────
  const siteUrl   = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const reviewUrl = `${siteUrl}/dashboard/reviews`;
  let newCount    = 0;

  const gmContacts = await getGmContacts(siteId);

  for (const review of gmbReviews) {
    const rating      = STAR_TO_NUM[review.starRating];
    const reviewDate  = review.createTime.slice(0, 10);
    const reviewText  = review.comment ?? "";
    const reviewer    = review.reviewer.isAnonymous ? "Anonymous" : review.reviewer.displayName;
    const sentiment   = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
    const isNew       = !knownNames.has(review.name);
    const hasReply    = Boolean(review.reviewReply?.comment);

    // Generate AI draft for unreplied reviews
    const draft = generateResponseDraft({
      guestName:      reviewer,
      rating,
      ratingScale:    5,
      reviewText,
      sentimentLabel: sentiment,
    });

    // Upsert — gmb_review_name is the unique conflict key for GMB reviews
    const { error: upsertErr } = await db
      .from("reviews")
      .upsert(
        {
          site_id:          siteId,
          platform:         "google" as const,
          rating,
          reviewer_name:    reviewer,
          reviewer_photo:   review.reviewer.profilePhotoUrl ?? null,
          review_text:      reviewText || null,
          review_date:      reviewDate,
          gmb_review_name:  review.name,
          source:           "gmb_api",
          sentiment,
          tags:             [],
          flagged:          rating < 4,
          ai_reply_draft:   draft,
          // Preserve existing reply_posted_at if reply already exists
          ...(hasReply && { reply_posted_at: review.reviewReply!.updateTime }),
        },
        { onConflict: "gmb_review_name" },
      );

    if (upsertErr) {
      logger.warn("gmb.sync: upsert failed", {
        siteId,
        reviewName: review.name,
        error:      upsertErr.message,
      });
      continue;
    }

    if (isNew) {
      newCount++;

      // ── Send WhatsApp alert for low-rated new reviews ───────────────────────
      if (rating <= 3 && gmContacts.length > 0) {
        const message = buildReviewAlertMessage({
          siteName:   siteName,
          rating,
          reviewer,
          reviewText,
          draft,
          reviewUrl,
        });

        for (const contact of gmContacts) {
          try {
            await sendWhatsAppMessage(contact.phone_whatsapp, message);
            logger.info("gmb.sync: review alert sent", {
              siteId,
              rating,
              to: contact.phone_whatsapp.slice(0, 6) + "***",
            });
          } catch (waErr) {
            logger.warn("gmb.sync: WhatsApp alert failed", {
              siteId,
              error: String(waErr),
            });
            // Non-fatal — sync continues
          }
        }

        // Stamp alert_sent_at on the review row
        await db
          .from("reviews")
          .update({ alert_sent_at: new Date().toISOString() })
          .eq("gmb_review_name", review.name);
      }
    }
  }

  await logSync(db, siteId, newCount, "success");

  logger.info("gmb.sync: site complete", { siteId, newCount, total: gmbReviews.length });
  return { siteId, outcome: "success", newReviews: newCount };
}

/**
 * Sync GMB reviews for all sites that have a valid site_gmb_tokens row.
 * Called from the cron path in google-sync/route.ts.
 */
export async function syncAllGmbReviews(): Promise<{
  synced:  number;
  skipped: number;
  errors:  string[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getServiceRoleClient() as any;

  const { data: tokenRows, error } = await db
    .from("site_gmb_tokens")
    .select("site_id")
    .not("gmb_location_id", "is", null);

  if (error || !tokenRows?.length) {
    return { synced: 0, skipped: 0, errors: [] };
  }

  let synced  = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const { site_id } of tokenRows as { site_id: string }[]) {
    const result = await syncSiteGmbReviews(site_id);

    if (result.outcome === "success")  synced++;
    else if (result.outcome === "no_token") skipped++;
    else errors.push(site_id);
  }

  return { synced, skipped, errors };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function logSync(
  db: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  siteId: string,
  newReviewsCount: number,
  outcome: "success" | "error" | "no_token",
  errorMessage?: string,
): Promise<void> {
  const { error } = await db.from("gmb_review_sync_log").insert({
    site_id:           siteId,
    new_reviews_count: newReviewsCount,
    outcome,
    error_message:     errorMessage ?? null,
  });

  if (error) {
    logger.warn("gmb.sync: failed to write sync log", { siteId, error: error.message });
  }
}
