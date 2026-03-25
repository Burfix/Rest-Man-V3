import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { microsSettingsSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

const SAFE_COLUMNS = "id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "GET /api/micros/settings");
  if (guard.error) return guard.error;
  const { supabase } = guard;

  try {
    const { data, error } = await supabase
      .from("micros_connections")
      .select(SAFE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({ connection: data ?? null });
  } catch (err) {
    logger.error("Failed to fetch MICROS settings", { route: "GET /api/micros/settings", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "POST /api/micros/settings");
  if (guard.error) return guard.error;
  const { supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(microsSettingsSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const payload = {
      location_name: (d.location_name ?? "Pilot Store").trim(),
      loc_ref: (d.loc_ref ?? "").trim(),
      auth_server_url: d.auth_server_url.trim().replace(/\/$/, ""),
      app_server_url: d.app_server_url.trim().replace(/\/$/, ""),
      client_id: d.client_id.trim(),
      org_identifier: d.org_identifier.trim(),
      status: "awaiting_setup",
    };

    if (d.id) {
      const { data, error } = await supabase
        .from("micros_connections")
        .update(payload)
        .eq("id", d.id)
        .select(SAFE_COLUMNS)
        .single();
      if (error) throw error;
      return NextResponse.json({ connection: data });
    }

    const { data, error } = await supabase
      .from("micros_connections")
      .insert(payload)
      .select(SAFE_COLUMNS)
      .single();
    if (error) throw error;
    logger.info("MICROS connection created", { route: "POST /api/micros/settings" });
    return NextResponse.json({ connection: data }, { status: 201 });
  } catch (err) {
    logger.error("Failed to save MICROS settings", { route: "POST /api/micros/settings", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
