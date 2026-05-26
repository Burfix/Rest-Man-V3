/**
 * GET /api/integrations/micros/test-token
 *
 * Tests whether a live Bearer token can be obtained for the given location.
 *
 * Query params:
 *   locationKey  — "si-cantina" | "primi-camps-bay"
 *
 * Returns:
 *   { locationKey, configured, tokenReceived, expiresIn, error }
 *
 * SECURITY:
 *   - Admin-protected (MANAGE_INTEGRATIONS permission required).
 *   - The token itself is NEVER returned. Only tokenReceived boolean + expiresIn.
 *   - No secrets are logged or exposed in responses.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import {
  getLocationConfig,
  isValidLocationKey,
  safeConfigSummary,
} from "@/lib/micros/micros-location-registry";
import {
  acquireLocationToken,
  clearLocationTokenCache,
  LocationAuthError,
} from "@/lib/micros/location-auth";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "GET /api/integrations/micros/test-token");
  if (guard.error) return guard.error;

  const locationKey = req.nextUrl.searchParams.get("locationKey") ?? "";

  if (!await isValidLocationKey(locationKey)) {
    return NextResponse.json(
      { error: `Invalid locationKey: "${locationKey}". Check micros_location_configs table for registered locations.` },
      { status: 400 },
    );
  }

  const cfg = await getLocationConfig(locationKey);
  const summary = safeConfigSummary(cfg);

  if (!cfg.configured) {
    return NextResponse.json({
      locationKey,
      configured: false,
      tokenReceived: false,
      expiresIn: null,
      error: `Location "${cfg.displayName}" is not fully configured. Check environment variables.`,
      configSummary: summary,
    });
  }

  if (!cfg.enabled) {
    return NextResponse.json({
      locationKey,
      configured: true,
      tokenReceived: false,
      expiresIn: null,
      error: `Location "${cfg.displayName}" integration is disabled.`,
      configSummary: summary,
    });
  }

  // Force a fresh token acquisition (clears any stale cache)
  clearLocationTokenCache(locationKey);

  const checkedAt = new Date().toISOString();

  try {
    const token = await acquireLocationToken(cfg);
    // Do NOT return the token. Derive only safe metadata.
    const expiresIn = cfg.authFlow === "pkce" ? 14 * 24 * 3600 : 3600;

    // Persist success to DB (best-effort)
    try {
      const supabase = createServerClient();
      await supabase
        .from("micros_connections")
        .update({ status: "connected", last_sync_error: null })
        .eq("location_key", locationKey);
    } catch { /* non-fatal */ }

    // Wipe token from this scope immediately — it was used only for the test
    void token; // intentionally unused after the check

    return NextResponse.json({
      locationKey,
      displayName:   cfg.displayName,
      configured:    true,
      enabled:       true,
      tokenReceived: true,
      authFlow:      cfg.authFlow,
      expiresIn,
      error:         null,
      checkedAt,
    });

  } catch (err) {
    const isAuthErr = err instanceof LocationAuthError;
    const message   = isAuthErr ? err.userMessage : (err instanceof Error ? err.message : String(err));
    const stage     = isAuthErr ? err.stage : "unknown";

    // Persist error to DB (best-effort)
    try {
      const supabase = createServerClient();
      await supabase
        .from("micros_connections")
        .update({ status: "error", last_sync_error: `[${stage}] ${message}` })
        .eq("location_key", locationKey);
    } catch { /* non-fatal */ }

    return NextResponse.json({
      locationKey,
      displayName:   cfg.displayName,
      configured:    true,
      enabled:       true,
      tokenReceived: false,
      authFlow:      cfg.authFlow,
      expiresIn:     null,
      error:         message,
      stage,
      checkedAt,
    });
  }
}
