/**
 * GET /api/auth/google/locations
 * Returns GMB locations for a connected site's account.
 *
 * PATCH /api/auth/google/locations
 * Saves the selected gmb_location_id for a site.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface GmbLocation {
  name:     string;
  title:    string;
  address?: string;
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.access_token ?? null;
}

async function fetchLocations(accessToken: string, accountId: string): Promise<GmbLocation[]> {
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title,storefrontAddress`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return [];
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (json.locations ?? []).map((l: any) => ({
    name:    l.name,
    title:   l.title ?? l.name,
    address: l.storefrontAddress?.addressLines?.join(", ") ?? "",
  }));
}

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "GET /api/auth/google/locations");
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId = req.nextUrl.searchParams.get("siteId") ?? ctx.siteId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getServiceRoleClient() as any;

  const { data: tokenRow, error: dbErr } = await supabase
    .from("site_gmb_tokens")
    .select("access_token, refresh_token, token_expires_at, gmb_account_id")
    .eq("site_id", siteId)
    .single();

  if (dbErr || !tokenRow) {
    return NextResponse.json({ error: "No GMB connection found for this site." }, { status: 404 });
  }

  if (!tokenRow.gmb_account_id) {
    return NextResponse.json({ error: "No GMB account linked. Please reconnect." }, { status: 400 });
  }

  let accessToken = tokenRow.access_token;
  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() > expiresAt - 60_000) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token);
    if (!refreshed) {
      return NextResponse.json({ error: "Token expired. Please reconnect Google Business." }, { status: 401 });
    }
    accessToken = refreshed;
    await supabase
      .from("site_gmb_tokens")
      .update({ access_token: refreshed, token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString() })
      .eq("site_id", siteId);
  }

  const locations = await fetchLocations(accessToken, tokenRow.gmb_account_id);
  return NextResponse.json({ locations });
}

export async function PATCH(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "PATCH /api/auth/google/locations");
  if (guard.error) return guard.error;

  let body: { siteId?: string; locationId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const siteId     = body.siteId;
  const locationId = body.locationId?.trim();
  if (!siteId || !locationId) return NextResponse.json({ error: "siteId and locationId are required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getServiceRoleClient() as any;
  const { error } = await supabase.from("site_gmb_tokens").update({ gmb_location_id: locationId }).eq("site_id", siteId);
  if (error) {
    logger.error("Failed to save GMB location", { siteId, locationId, error });
    return NextResponse.json({ error: "Failed to save location" }, { status: 500 });
  }

  logger.info("GMB location selected", { siteId, locationId });
  return NextResponse.json({ ok: true, locationId });
}
