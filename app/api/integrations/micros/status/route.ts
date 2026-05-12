/**
 * GET /api/integrations/micros/status
 *
 * Returns connection and data freshness status for a specific MICROS location.
 *
 * Query params:
 *   locationKey  — "si-cantina" | "primi-camps-bay"
 *
 * Returns:
 *   {
 *     locationKey, displayName, enabled, configured,
 *     connectionStatus, microsLocationRef,
 *     lastSyncAt, lastError,
 *     hasSalesToday, hasLabourToday
 *   }
 *
 * SECURITY:
 *   - Requires VIEW_OWN_STORE permission.
 *   - No credentials, tokens, or secrets in response.
 */

import { NextRequest, NextResponse }    from "next/server";
import { apiGuard }                     from "@/lib/auth/api-guard";
import { PERMISSIONS }                  from "@/lib/rbac/roles";
import {
  getLocationConfig,
  isValidLocationKey,
  safeConfigSummary,
} from "@/lib/micros/micros-location-registry";
import { createServerClient }           from "@/lib/supabase/server";
import { todayISO }                     from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/integrations/micros/status");
  if (guard.error) return guard.error;

  const locationKey = req.nextUrl.searchParams.get("locationKey") ?? "";

  if (!isValidLocationKey(locationKey)) {
    return NextResponse.json(
      { error: `Invalid locationKey. Expected: si-cantina | primi-camps-bay. Got: ${locationKey}` },
      { status: 400 },
    );
  }

  const cfg     = getLocationConfig(locationKey);
  const summary = safeConfigSummary(cfg);
  const today   = todayISO();

  // Fetch DB connection row for this location
  const supabase = createServerClient();
  const { data: conn } = await supabase
    .from("micros_connections")
    .select(
      "id, location_name, location_key, loc_ref, status, last_sync_at, last_sync_error, last_successful_sync_at"
    )
    .eq("location_key", locationKey)
    .maybeSingle();

  // Check for sales data today
  const { data: salesRow } = conn?.id
    ? await supabase
        .from("micros_sales_daily")
        .select("business_date")
        .eq("connection_id", conn.id)
        .eq("business_date", today)
        .maybeSingle()
    : { data: null };

  // Check for labour summary today
  const locRef = conn?.loc_ref || cfg.locationRef;
  const { data: labourRow } = locRef
    ? await supabase
        .from("labour_daily_summary")
        .select("business_date")
        .eq("loc_ref", locRef)
        .eq("business_date", today)
        .maybeSingle()
    : { data: null };

  return NextResponse.json({
    locationKey,
    displayName:       cfg.displayName,
    enabled:           cfg.enabled,
    configured:        cfg.configured,
    authFlow:          cfg.authFlow,
    connectionStatus:  conn?.status ?? (cfg.configured ? "pending" : "awaiting_setup"),
    microsLocationRef: conn?.loc_ref ?? cfg.locationRef ?? null,
    lastSyncAt:        conn?.last_sync_at ?? null,
    lastSuccessfulSyncAt: conn?.last_successful_sync_at ?? null,
    lastError:         conn?.last_sync_error ?? null,
    hasSalesToday:     !!salesRow,
    hasLabourToday:    !!labourRow,
    configSummary:     summary,
    checkedAt:         new Date().toISOString(),
  });
}
