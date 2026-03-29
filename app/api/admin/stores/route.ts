/**
 * GET  /api/admin/stores       — list org stores
 * POST /api/admin/stores       — create a new store
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { createStoreSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "GET /api/admin/stores");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const unrestricted = isSuperAdmin(ctx);

    if (!unrestricted && !ctx.orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

    const q = supabase
      .from("sites")
      .select("*")
      .order("name");
    if (!unrestricted && ctx.orgId) q.eq("organisation_id", ctx.orgId);

    const { data, error } = await q;

    if (error) {
      logger.error("Failed to fetch stores", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ stores: data ?? [] });
  } catch (err) {
    logger.error("Admin stores GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "POST /api/admin/stores");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    if (!ctx.orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

    const body = await req.json();
    const v = validateBody(createStoreSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data, error } = await supabase
      .from("sites")
      .insert({
        name: d.name,
        store_code: d.store_code,
        site_type: "restaurant",
        address: d.address ?? null,
        city: d.city ?? null,
        timezone: d.timezone,
        organisation_id: ctx.orgId,
        region_id: d.region_id ?? null,
        seating_capacity: d.seating_capacity ?? null,
        target_avg_spend: d.target_avg_spend ?? null,
        target_labour_pct: d.target_labour_pct ?? null,
        target_margin_pct: d.target_margin_pct ?? null,
      })
      .select("*")
      .single();

    if (error) {
      logger.error("Failed to create store", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      action: "store.created",
      metadata: { store_id: (data as any).id, store_name: d.name },
    } as any);

    return NextResponse.json({ store: data }, { status: 201 });
  } catch (err) {
    logger.error("Admin stores POST failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
