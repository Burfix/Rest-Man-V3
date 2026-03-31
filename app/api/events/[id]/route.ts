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

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "Missing event ID" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await (supabase as any)
    .from("site_events")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
