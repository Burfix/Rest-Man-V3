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
import type { VStore } from "@/lib/admin/contractTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "GET /api/admin/stores");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const unrestricted = isSuperAdmin(ctx);

    if (!unrestricted && !ctx.orgId) return NextResponse.json({ data: [], error: "No organisation" }, { status: 400 });

    // Read from the contract-layer view v_stores (migration 065).
    // This is the canonical source for store counts across all dashboard tabs.
    const q = supabase
      .from("v_stores")
      .select("id, name, store_code, address, city, timezone, is_active, org_id, org_name, region_id, seating_capacity, target_avg_spend, target_labour_pct, target_margin_pct, created_at")
      .order("name");
    if (!unrestricted && ctx.orgId) q.eq("org_id", ctx.orgId);

    const { data, error } = await q;

    if (error) {
      logger.error("Failed to fetch stores", { err: error });
      return NextResponse.json({ data: [], error: error.message }, { status: 500 });
    }

    // Map v_stores to the Store shape expected by the admin UI.
    // organisation_id is aliased for backward compatibility with UI code.
    const stores = ((data as VStore[] | null) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      store_code: s.store_code,
      address: s.address,
      city: s.city,
      timezone: s.timezone,
      is_active: s.is_active,
      organisation_id: s.org_id,
      region_id: s.region_id,
      seating_capacity: s.seating_capacity,
      target_avg_spend: s.target_avg_spend,
      target_labour_pct: s.target_labour_pct,
      target_margin_pct: s.target_margin_pct,
      created_at: s.created_at,
    }));

    if (stores.length === 0 && !error) {
      logger.warn("ADMIN_API_EMPTY_DATA", {
        route: "GET /api/admin/stores",
        view: "v_stores",
        orgId: ctx.orgId,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ data: stores, error: null });
  } catch (err) {
    logger.error("Admin stores GET failed", { err });
    return NextResponse.json({ data: [], error: "Internal server error" }, { status: 500 });
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
