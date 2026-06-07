/**
 * GET /api/auth/google/callback
 *
 * Handles the Google OAuth callback after the user grants consent.
 * Exchanges the auth code for access + refresh tokens, discovers the
 * GMB account and location list, then stores tokens in site_gmb_tokens.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_SITE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in:    number;
  token_type:    string;
  scope:         string;
}

interface GmbAccount {
  name:        string; // "accounts/{id}"
  accountName: string;
  type:        string;
}

interface GmbLocation {
  name:         string; // "accounts/{id}/locations/{id}"
  title:        string;
  storefrontAddress?: { addressLines?: string[] };
}

async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    // Log full error for debugging
    logger.error("Token exchange HTTP error", { status: res.status, body: err, redirectUri });
    throw new Error(`Token exchange failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  // Log token fields received (no values) for debugging
  logger.info("Token exchange success", {
    hasAccessToken: Boolean(json.access_token),
    hasRefreshToken: Boolean(json.refresh_token),
    expiresIn: json.expires_in,
    scope: json.scope,
  });
  return json;
}

async function getGmbAccounts(accessToken: string): Promise<GmbAccount[]> {
  const res = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.accounts ?? [];
}

async function getGmbLocations(
  accessToken: string,
  accountName: string,
): Promise<GmbLocation[]> {
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const json = await res.json();
  return json.locations ?? [];
}

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // User denied consent
  if (error) {
    logger.warn("Google OAuth denied", { error });
    return NextResponse.redirect(
      `${siteUrl}/dashboard/settings/integrations?gmb=denied`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${siteUrl}/dashboard/settings/integrations?gmb=error&reason=missing_params`,
    );
  }

  // Decode state
  let siteId: string;
  let userId: string;
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8"),
    );
    siteId = decoded.siteId;
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(
      `${siteUrl}/dashboard/settings/integrations?gmb=error&reason=invalid_state`,
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode(code, redirectUri);

    if (!tokens.refresh_token) {
      // This happens if user already granted consent before and didn't revoke
      // The prompt=consent param should prevent this but handle it gracefully
      logger.warn("Google OAuth: no refresh token received", { siteId });
      return NextResponse.redirect(
        `${siteUrl}/dashboard/settings/integrations?gmb=error&reason=no_refresh_token`,
      );
    }

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // Discover GMB accounts and locations
    const accounts  = await getGmbAccounts(tokens.access_token);
    const primary   = accounts[0] ?? null;
    let locationId: string | null = null;

    if (primary) {
      const locations = await getGmbLocations(tokens.access_token, primary.name);
      // Auto-select if only one location
      if (locations.length === 1) {
        locationId = locations[0].name;
      }
      // Multiple locations → store account, let user pick location in UI
    }

    // Upsert into site_gmb_tokens
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = getServiceRoleClient() as any;
    const { error: dbError } = await supabase
      .from("site_gmb_tokens")
      .upsert(
        {
          site_id:          siteId,
          access_token:     tokens.access_token,
          refresh_token:    tokens.refresh_token,
          token_expires_at: expiresAt,
          gmb_account_id:   primary?.name ?? null,
          gmb_location_id:  locationId,
          connected_by:     userId,
          connected_at:     new Date().toISOString(),
        },
        { onConflict: "site_id" },
      );

    if (dbError) {
      logger.error("Failed to store GMB tokens", { siteId, dbError });
      return NextResponse.redirect(
        `${siteUrl}/dashboard/settings/integrations?gmb=error&reason=db_error`,
      );
    }

    logger.info("Google My Business connected", {
      siteId,
      accountId: primary?.name,
      locationId,
    });

    // Redirect back to integrations — UI reads the query param to show success toast
    const successUrl = locationId
      ? `${siteUrl}/dashboard/settings/integrations?gmb=connected`
      : `${siteUrl}/dashboard/settings/integrations?gmb=pick_location&account=${encodeURIComponent(primary?.name ?? "")}`;

    return NextResponse.redirect(successUrl);
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 120).replace(/\s+/g, "_") : "unknown";
    logger.error("Google OAuth callback failed", { siteId, err });
    return NextResponse.redirect(
      `${siteUrl}/dashboard/settings/integrations?gmb=error&reason=${encodeURIComponent(reason)}`,
    );
  }
}
