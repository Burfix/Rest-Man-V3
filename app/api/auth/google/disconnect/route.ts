/**
 * DELETE /api/auth/google/disconnect
 *
 * Revokes the Google OAuth connection for a site.
 * Deletes tokens from site_gmb_tokens and revokes the token with Google.
 *
 * Query params:
 *   ?siteId=<uuid>
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest) {
  const guard = await apiGuard(
    PERMISSIONS.MANAGE_INTEGRATIONS,
    "DELETE /api/auth/google/disconnect",
  );
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId = req.nextUrl.searchParams.get("siteId") ?? ctx.siteId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getServiceRoleClient() as any;

  // Get the token to revoke it with Google first
  const { data: tokenRow } = await supabase
    .from("site_gmb_tokens")
    .select("access_token, refresh_token")
    .eq("site_id", siteId)
    .single();

  if (tokenRow?.refresh_token) {
    // Best-effort revoke with Google
    fetch(`https://oauth2.googleapis.com/revoke?token=${tokenRow.refresh_token}`, {
      method: "POST",
    }).catch(() => {
      // Non-fatal — token may already be expired
    });
  }

  const { error } = await supabase
    .from("site_gmb_tokens")
    .delete()
    .eq("site_id", siteId);

  if (error) {
    logger.error("Failed to disconnect GMB", { siteId, error });
    return NextResponse.json(
      { error: "Failed to disconnect Google Business" },
      { status: 500 },
    );
  }

  logger.info("Google My Business disconnected", { siteId });
  return NextResponse.json({ ok: true });
}
