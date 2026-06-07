/**
 * lib/gmb/token.ts
 *
 * Google My Business OAuth token management.
 *
 * Responsibilities:
 *  - Fetch the stored token row for a site
 *  - Detect expiry (with 5-minute buffer)
 *  - Refresh via Google's token endpoint when needed
 *  - Persist the refreshed token back to site_gmb_tokens
 *
 * Never exposes raw token values in logs — only metadata is logged.
 */

import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger }               from "@/lib/logger";

export interface GmbTokenRow {
  site_id:          string;
  access_token:     string;
  refresh_token:    string;
  token_expires_at: string;
  gmb_account_id:   string | null;
  gmb_location_id:  string | null;
}

interface TokenRefreshResponse {
  access_token: string;
  expires_in:   number;
  token_type:   string;
  scope?:       string;
}

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before actual expiry

/**
 * Returns a valid access token for the given site, refreshing if needed.
 * Returns null if the site has no GMB token row or refresh fails.
 */
export async function getValidGmbToken(siteId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getServiceRoleClient() as any;

  const { data: rowRaw, error } = await db
    .from("site_gmb_tokens")
    .select("site_id, access_token, refresh_token, token_expires_at, gmb_account_id, gmb_location_id")
    .eq("site_id", siteId)
    .single();
  const row = rowRaw as GmbTokenRow | null;

  if (error || !row) {
    logger.info("gmb.token: no token found for site", { siteId });
    return null;
  }

  // Check if still valid (with buffer)
  const expiresAt  = new Date(row.token_expires_at).getTime();
  const isExpiring = Date.now() + EXPIRY_BUFFER_MS >= expiresAt;

  if (!isExpiring) {
    return row.access_token;
  }

  // Refresh
  logger.info("gmb.token: refreshing expiring token", { siteId });
  const refreshed = await refreshAccessToken(row.refresh_token);
  if (!refreshed) return null;

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateErr } = await db
    .from("site_gmb_tokens")
    .update({
      access_token:     refreshed.access_token,
      token_expires_at: newExpiresAt,
    })
    .eq("site_id", siteId);

  if (updateErr) {
    logger.warn("gmb.token: failed to persist refreshed token", {
      siteId,
      error: updateErr.message,
    });
    // Return the new token anyway — it's valid in memory
  }

  return refreshed.access_token;
}

/**
 * Fetch the full token row including location metadata.
 * Performs a refresh if needed before returning.
 */
export async function getGmbTokenRow(siteId: string): Promise<GmbTokenRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getServiceRoleClient() as any;

  const { data: rowRaw, error } = await db
    .from("site_gmb_tokens")
    .select("site_id, access_token, refresh_token, token_expires_at, gmb_account_id, gmb_location_id")
    .eq("site_id", siteId)
    .single();
  const row = rowRaw as GmbTokenRow | null;

  if (error || !row) return null;

  // Refresh if expiring
  const expiresAt  = new Date(row.token_expires_at).getTime();
  const isExpiring = Date.now() + EXPIRY_BUFFER_MS >= expiresAt;

  if (!isExpiring) return row;

  logger.info("gmb.token: refreshing expiring token (full row)", { siteId });
  const refreshed = await refreshAccessToken(row.refresh_token);
  if (!refreshed) return null;

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  await db
    .from("site_gmb_tokens")
    .update({ access_token: refreshed.access_token, token_expires_at: newExpiresAt })
    .eq("site_id", siteId);

  return { ...row, access_token: refreshed.access_token, token_expires_at: newExpiresAt };
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenRefreshResponse | null> {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logger.error("gmb.token: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured");
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("gmb.token: token refresh failed", {
        status: res.status,
        // Truncate to avoid logging any partial token data
        body: text.slice(0, 200),
      });
      return null;
    }

    return (await res.json()) as TokenRefreshResponse;
  } catch (err) {
    logger.error("gmb.token: token refresh threw", { err });
    return null;
  }
}
