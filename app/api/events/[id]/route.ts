/**
 * DELETE /api/events/[id] — delete a site event by ID
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiGuard } from "@/lib/auth/api-guard";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(null, "DELETE /api/events/[id]");
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Missing event ID" }, { status: 400 });
  }

  const supabase = createServerClient();

  // TENANT GUARD: verify event belongs to caller's site before deleting
  const { data: existing } = await (supabase as any)
    .from("site_events")
    .select("site_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!ctx.siteIds.includes(existing.site_id)) {
    return NextResponse.json(
      { error: "Access denied: this event does not belong to your site" },
      { status: 403 },
    );
  }

  const { error } = await (supabase as any)
    .from("site_events")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
