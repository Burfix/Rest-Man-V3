/**
 * POST /api/micros/test-connection
 *
 * Validates that the supplied (or saved) credentials can authenticate
 * against Oracle Identity Cloud.
 *
 * Body (optional — if omitted uses saved connection):
 *   { auth_server_url?, client_id?, org_identifier? }
 *
 * Returns: { success: true } or { success: false, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient }        from "@/lib/supabase/server";
import { testMicrosAuth }            from "@/services/micros/auth";
import type { MicrosConnection }     from "@/types/micros";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Partial<MicrosConnection>;

    const supabase = createServerClient();

    // Load saved connection as base
    const { data: saved } = await supabase
      .from("micros_connections")
      .select("id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Merge: body overrides saved
    const connection: MicrosConnection = {
      ...(saved ?? {}),
      ...(body.auth_server_url ? { auth_server_url: body.auth_server_url } : {}),
      ...(body.client_id       ? { client_id:       body.client_id }       : {}),
      ...(body.org_identifier  ? { org_identifier:  body.org_identifier }  : {}),
    } as MicrosConnection;

    if (!connection.auth_server_url?.trim()) {
      return NextResponse.json({ success: false, error: "auth_server_url is required." }, { status: 400 });
    }
    if (!connection.client_id?.trim()) {
      return NextResponse.json({ success: false, error: "client_id is required." }, { status: 400 });
    }

    const clientSecret = process.env.MICROS_CLIENT_SECRET;
    if (!clientSecret) {
      return NextResponse.json(
        {
          success: false,
          error:   "MICROS_CLIENT_SECRET is not configured on this server. Add it to your environment variables.",
        },
        { status: 500 },
      );
    }

    await testMicrosAuth(connection);

    // Update status to connected if we have a saved row
    if (saved?.id) {
      await supabase
        .from("micros_connections")
        .update({ status: "connected", last_sync_error: null })
        .eq("id", saved.id);
    }

    return NextResponse.json({ success: true });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connection test failed.";
    return NextResponse.json({ success: false, error: msg }, { status: 400 });
  }
}
