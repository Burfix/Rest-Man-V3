import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { microsSettingsSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

const SAFE_COLUMNS = "id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "GET /api/micros/settings");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  // Optional ?siteId= param — validate it's accessible, fallback to ctx.siteId
  const url = new URL(req.url);
  const querySiteId = url.searchParams.get("siteId");
  if (querySiteId && !ctx.siteIds.includes(querySiteId)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const targetSiteId = querySiteId ?? ctx.siteId;

  try {
    const { data, error } = await supabase
      .from("micros_connections")
      .select(SAFE_COLUMNS)
      .eq("site_id" as never, targetSiteId)
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
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(microsSettingsSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // Resolve the target site — use body.siteId if provided and accessible
    const bodySiteId = (body as Record<string, unknown>).siteId as string | undefined;
    if (bodySiteId && !ctx.siteIds.includes(bodySiteId)) {
      return NextResponse.json({ error: "Access denied: site not in your accessible sites" }, { status: 403 });
    }
    const targetSiteId = bodySiteId ?? ctx.siteId;

    const payload = {
      location_name: (d.location_name ?? "Pilot Store").trim(),
      loc_ref: (d.loc_ref ?? "").trim(),
      sales_location_ref: d.sales_location_ref?.trim() || null,
      auth_server_url: d.auth_server_url.trim().replace(/\/$/, ""),
      app_server_url: d.app_server_url.trim().replace(/\/$/, ""),
      client_id: d.client_id.trim(),
      org_identifier: d.org_identifier.trim(),
      status: "awaiting_setup",
    };

    if (d.id) {
      // Verify this connection belongs to an accessible site before updating
      const { data: existing } = await supabase
        .from("micros_connections")
        .select("site_id")
        .eq("id", d.id)
        .maybeSingle();
      const existingSiteId = (existing as { site_id?: string } | null)?.site_id;
      if (existingSiteId && !ctx.siteIds.includes(existingSiteId)) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

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
      .insert({ ...payload, site_id: targetSiteId })
      .select(SAFE_COLUMNS)
      .single();
    if (error) throw error;
    logger.info("MICROS connection created", { route: "POST /api/micros/settings", siteId: targetSiteId });
    return NextResponse.json({ connection: data }, { status: 201 });
  } catch (err) {
    logger.error("Failed to save MICROS settings", { route: "POST /api/micros/settings", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
