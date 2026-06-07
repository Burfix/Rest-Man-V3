/**
 * GET /api/auth/google/connect
 *
 * Initiates the Google OAuth flow for Google My Business (Business Profile API).
 * Redirects the user to Google's consent screen.
 *
 * Query params:
 *   ?siteId=<uuid>  — the site to connect Google Business to
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_SITE_URL
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "openid",
  "email",
].join(" ");

export async function GET(req: NextRequest) {
  const guard = await apiGuard(
    PERMISSIONS.MANAGE_INTEGRATIONS,
    "GET /api/auth/google/connect",
  );
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId = req.nextUrl.searchParams.get("siteId") ?? ctx.siteId;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL;

  if (!clientId || !siteUrl) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and NEXT_PUBLIC_SITE_URL." },
      { status: 500 },
    );
  }

  const redirectUri = `${siteUrl}/api/auth/google/callback`;

  // Encode siteId + userId in state param (CSRF protection)
  const state = Buffer.from(
    JSON.stringify({ siteId, userId: ctx.userId }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         SCOPES,
    access_type:   "offline",   // gets refresh token
    prompt:        "consent",   // forces refresh token every time
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
