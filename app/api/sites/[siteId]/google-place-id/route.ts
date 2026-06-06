/**
 * PATCH /api/sites/[siteId]/google-place-id
 *
 * Saves a Google Place ID to sites.google_place_id.
 * Requires: super_admin or head_office role (admin-level only).
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createServerClient } from "@/lib/supabase/server";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const guard = await apiGuard(
    PERMISSIONS.MANAGE_INTEGRATIONS ?? PERMISSIONS.RESPOND_TO_REVIEWS,
    "PATCH /api/sites/[siteId]/google-place-id",
  );
  if (guard.error) return guard.error;

  const { supabase } = guard;
  const { siteId } = params;

  let body: { google_place_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const placeId = (body.google_place_id ?? "").trim();

  // Allow clearing (empty string → null)
  const { error } = await supabase
    .from("sites")
    .update({ google_place_id: placeId || null, updated_at: new Date().toISOString() })
    .eq("id", siteId);

  if (error) {
    console.error("[sites/google-place-id] DB error:", error);
    return NextResponse.json({ error: "Failed to save Place ID" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, google_place_id: placeId || null });
}
