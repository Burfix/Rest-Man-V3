/**
 * GET /api/admin/integrations — per-store integration status overview
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/integrations");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Fetch all stores
    const storeQuery = supabase.from("sites").select("id, name, store_code, is_active, organisation_id");
    if (!isSuperAdmin(ctx) && ctx.orgId) storeQuery.eq("organisation_id", ctx.orgId);
    const { data: stores } = await storeQuery;

    const siteIds = (stores ?? []).map((s: any) => s.id);
    if (siteIds.length === 0) return NextResponse.json({ integrations: [], summary: {} });

    // Fetch MICROS connections
    const { data: connections } = await supabase
      .from("micros_connections")
      .select("site_id, status, last_sync_at, micros_org_id, micros_loc_id, token_expires_at")
      .in("site_id", siteIds);

    const connMap = new Map((connections ?? []).map((c: any) => [c.site_id, c]));
    const now = Date.now();

    const integrations = (stores ?? []).map((store: any) => {
      const conn = connMap.get(store.id) as any;
      const hasConnection = !!conn;
      const isConnected = conn?.status === "connected";
      const tokenExpiry = conn?.token_expires_at ? new Date(conn.token_expires_at) : null;
      const tokenExpired = tokenExpiry ? tokenExpiry.getTime() < now : false;
      const lastSync = conn?.last_sync_at ? new Date(conn.last_sync_at) : null;
      const syncAge = lastSync ? Math.floor((now - lastSync.getTime()) / 60000) : null;

      let status: "connected" | "disconnected" | "expired" | "stale" | "none" = "none";
      if (!hasConnection) status = "none";
      else if (tokenExpired) status = "expired";
      else if (!isConnected) status = "disconnected";
      else if (syncAge !== null && syncAge > 1440) status = "stale";
      else status = "connected";

      return {
        store_id: store.id,
        store_name: store.name,
        store_code: store.store_code,
        is_active: store.is_active,
        micros: {
          connected: isConnected,
          status,
          org_id: conn?.micros_org_id ?? null,
          loc_id: conn?.micros_loc_id ?? null,
          last_sync_at: conn?.last_sync_at ?? null,
          token_expires_at: conn?.token_expires_at ?? null,
          sync_age_minutes: syncAge,
        },
        // Placeholder for future integrations
        google_reviews: { connected: false, status: "none" },
        inventory: { connected: false, status: "none" },
      };
    });

    const summary = {
      total_stores: integrations.length,
      micros_connected: integrations.filter((i) => i.micros.status === "connected").length,
      micros_stale: integrations.filter((i) => i.micros.status === "stale").length,
      micros_expired: integrations.filter((i) => i.micros.status === "expired").length,
      micros_disconnected: integrations.filter((i) => i.micros.status === "disconnected").length,
      micros_none: integrations.filter((i) => i.micros.status === "none").length,
    };

    return NextResponse.json({ integrations, summary });
  } catch (err) {
    logger.error("Integrations GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
