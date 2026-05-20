/**
 * GET /api/admin/integrations — per-store integration status overview
 *
 * Reads from v_integrations (migration 065).
 * Token expiry and staleness are computed in SQL; no JS date calculations needed.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";
import type { VIntegration } from "@/lib/admin/contractTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/integrations");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Single query from the contract-layer view (replaces sites + micros_connections + JS join).
    const q = supabase
      .from("v_integrations")
      .select("store_id, store_name, store_code, is_active, org_id, micros_status, micros_org_id, micros_loc_id, last_sync_at, token_expires_at, sync_age_minutes, is_stale")
      .order("store_name");
    if (!isSuperAdmin(ctx) && ctx.orgId) q.eq("org_id", ctx.orgId);

    const { data, error } = await q;

    if (error) {
      logger.error("Integrations GET failed", { err: error });
      return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }

    const rows = (data as VIntegration[] | null) ?? [];

    if (rows.length === 0 && !error) {
      logger.warn("ADMIN_API_EMPTY_DATA", {
        route: "GET /api/admin/integrations",
        view: "v_integrations",
        orgId: ctx.orgId,
        timestamp: new Date().toISOString(),
      });
    }

    // Shape the response to match the admin UI's Integration interface.
    const integrations = rows.map((r) => ({
      store_id: r.store_id,
      store_name: r.store_name,
      store_code: r.store_code,
      is_active: r.is_active,
      micros: {
        connected: r.micros_status === "connected",
        status: r.micros_status,
        org_id: r.micros_org_id,
        loc_id: r.micros_loc_id,
        last_sync_at: r.last_sync_at,
        token_expires_at: r.token_expires_at,
        sync_age_minutes: r.sync_age_minutes,
      },
      // Extensible placeholders for future integration types
      google_reviews: { connected: false, status: "none" },
      inventory: { connected: false, status: "none" },
    }));

    // Summary counts derived from the same view rows — consistent by definition.
    const summary = {
      total_stores: integrations.length,
      micros_connected:     integrations.filter((i) => i.micros.status === "connected").length,
      micros_stale:         integrations.filter((i) => i.micros.status === "stale").length,
      micros_expired:       integrations.filter((i) => i.micros.status === "expired").length,
      micros_disconnected:  integrations.filter((i) => i.micros.status === "disconnected").length,
      micros_none:          integrations.filter((i) => i.micros.status === "none").length,
    };

    return NextResponse.json({ data: { integrations, summary }, error: null });
  } catch (err) {
    logger.error("Integrations GET failed", { err });
    return NextResponse.json({ data: null, error: "Internal server error" }, { status: 500 });
  }
}
