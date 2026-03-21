/**
 * POST /api/micros/test-connection
 *
 * Safe stub -- no connection attempt is made.
 * Returns a "not_attempted" response until Oracle confirms the supported
 * authentication method for this integration.
 */

import { NextResponse }       from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  // Clear any stale error from previous auth attempts
  try {
    const supabase = createServerClient();
    await supabase
      .from("micros_connections")
      .update({ last_sync_error: null, status: "awaiting_setup" })
      .neq("id", "00000000-0000-0000-0000-000000000000"); // update all rows
  } catch { /* best-effort */ }

  return NextResponse.json({
    ok:         false,
    status:     "not_attempted",
    message:    "No connection test has been run because the exact Oracle-supported authentication method has not yet been confirmed.",
    checkedAt:  new Date().toISOString(),
  });
}
