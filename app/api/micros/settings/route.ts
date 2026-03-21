/**
 * GET  /api/micros/settings — return current connection config (no token fields)
 * POST /api/micros/settings — upsert connection config (create or update)
 *
 * Credentials are stored server-side in Supabase behind service_role RLS.
 * The client_secret is never stored in the DB — it lives in the
 * MICROS_CLIENT_SECRET env var only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient }        from "@/lib/supabase/server";
import type { MicrosConnectionConfig } from "@/types/micros";

const SAFE_COLUMNS =
  "id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("micros_connections")
      .select(SAFE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ connection: data ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<MicrosConnectionConfig> & { id?: string };

    const {
      id,
      location_name,
      loc_ref,
      auth_server_url,
      app_server_url,
      client_id,
      org_identifier,
    } = body;

    if (!auth_server_url?.trim()) return NextResponse.json({ error: "auth_server_url is required." }, { status: 400 });
    if (!app_server_url?.trim())  return NextResponse.json({ error: "app_server_url is required." },  { status: 400 });
    if (!client_id?.trim())       return NextResponse.json({ error: "client_id is required." },        { status: 400 });
    if (!org_identifier?.trim())  return NextResponse.json({ error: "org_identifier is required." },   { status: 400 });

    const payload = {
      location_name:   (location_name ?? "Pilot Store").trim(),
      loc_ref:         (loc_ref ?? "").trim(),
      auth_server_url: auth_server_url.trim().replace(/\/$/, ""),
      app_server_url:  app_server_url.trim().replace(/\/$/, ""),
      client_id:       client_id.trim(),
      org_identifier:  org_identifier.trim(),
      status:          "awaiting_setup",
    };

    const supabase = createServerClient();

    if (id) {
      // Update existing
      const { data, error } = await supabase
        .from("micros_connections")
        .update(payload)
        .eq("id", id)
        .select(SAFE_COLUMNS)
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ connection: data });
    }

    // Insert new
    const { data, error } = await supabase
      .from("micros_connections")
      .insert(payload)
      .select(SAFE_COLUMNS)
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ connection: data }, { status: 201 });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
