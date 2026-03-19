/**
 * POST /api/micros/test-connection
 *
 * Validates that MICROS credentials can successfully authenticate and that
 * data can be retrieved from the BI API.
 *
 * Priority:
 *  1. If MICROS_ENABLED=true and env vars are configured, test using
 *     MicrosAuthService (OIDC ROPC flow with BI API account credentials).
 *     Also makes one lightweight BI API call to verify end-to-end connectivity.
 *  2. Otherwise, fall back to saved DB credentials (legacy path).
 *
 * Returns:
 *   { success: true, source: "env"|"db", authMs, apiMs, latencyMs }
 *   { success: false, source, error, missing? }
 *
 * NEVER returns the token, client_secret, account password, or any
 * credential value in any response path.
 */

import { NextRequest, NextResponse }              from "next/server";
import { createServerClient }                     from "@/lib/supabase/server";
import {
  isMicrosEnabled,
  getMicrosConfigStatus,
  getMicrosEnvConfig,
}                                                 from "@/lib/micros/config";
import { MicrosAuthService }                      from "@/services/micros/MicrosAuthService";
import { MicrosApiClient }                        from "@/services/micros/MicrosApiClient";
import { testMicrosAuth }                         from "@/services/micros/auth";
import type { MicrosConnection }                  from "@/types/micros";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  try {
    // ── Path 1: Env-var credentials (MICROS_ENABLED=true) ────────────────
    if (isMicrosEnabled()) {
      const cfgStatus = getMicrosConfigStatus();

      if (!cfgStatus.configured) {
        return NextResponse.json(
          {
            success: false,
            source:  "env",
            error:   cfgStatus.message,
            missing: cfgStatus.missing,
          },
          { status: 400 },
        );
      }

      // ── Step 1: Authenticate ──────────────────────────────────────────
      MicrosAuthService.clearCache();
      const authT0 = Date.now();

      try {
        await MicrosAuthService.getAccessToken();
      } catch (authErr) {
        const message = authErr instanceof Error ? authErr.message : "Authentication failed.";
        console.error("[POST /api/micros/test-connection] Auth step failed.");
        return NextResponse.json(
          { success: false, source: "env", error: message },
          { status: 400 },
        );
      }

      const authMs = Date.now() - authT0;

      // ── Step 2: Lightweight BI API call ───────────────────────────────
      const cfg    = getMicrosEnvConfig();
      const today  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const apiT0  = Date.now();
      let   apiMs  = 0;
      let   apiNote: string | undefined;

      try {
        await MicrosApiClient.get(
          process.env.MICROS_PATH_DAILY_TOTALS ?? "/rms/v1/reports/dailyBusinessSummary",
          { businessDate: today },
          cfg.locRef,
        );
        apiMs = Date.now() - apiT0;
      } catch (apiErr) {
        apiMs  = Date.now() - apiT0;
        // A 404 (no data for today) still proves routing works — treat as soft pass.
        // Any other error is surfaced as a warning without failing the whole test.
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        if (!msg.includes("404")) {
          apiNote = `BI API call returned an error: ${msg.slice(0, 200)}`;
          console.warn("[POST /api/micros/test-connection] BI API call warning:", msg);
        }
      }

      return NextResponse.json({
        success:   true,
        source:    "env",
        authMs,
        apiMs,
        latencyMs: Date.now() - t0,
        message:
          "Authentication successful and BI API is reachable." +
          (apiNote ? ` Note: ${apiNote}` : ""),
      });
    }

    // ── Path 2: DB credentials (legacy / fallback) ─────────────────────
    const body = await req.json().catch(() => ({})) as Partial<MicrosConnection>;
    const supabase = createServerClient();

    const { data: saved } = await supabase
      .from("micros_connections")
      .select("id, location_name, loc_ref, auth_server_url, app_server_url, client_id, org_identifier, status, last_sync_at, last_sync_error, last_successful_sync_at, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const connection: MicrosConnection = {
      ...(saved ?? {}),
      ...(body.auth_server_url ? { auth_server_url: body.auth_server_url } : {}),
      ...(body.client_id       ? { client_id:       body.client_id }       : {}),
      ...(body.org_identifier  ? { org_identifier:  body.org_identifier }  : {}),
    } as MicrosConnection;

    if (!connection.auth_server_url?.trim()) {
      return NextResponse.json(
        { success: false, source: "db", error: "auth_server_url is required." },
        { status: 400 },
      );
    }
    if (!connection.client_id?.trim()) {
      return NextResponse.json(
        { success: false, source: "db", error: "client_id is required." },
        { status: 400 },
      );
    }

    const clientSecret = process.env.MICROS_CLIENT_SECRET;
    if (!clientSecret) {
      return NextResponse.json(
        {
          success: false,
          source:  "db",
          error:
            "MICROS_CLIENT_SECRET is not configured. " +
            "Add it to your environment variables (Vercel project settings).",
        },
        { status: 500 },
      );
    }

    await testMicrosAuth(connection);

    if (saved?.id) {
      await supabase
        .from("micros_connections")
        .update({ status: "connected", last_sync_error: null })
        .eq("id", saved.id);
    }

    return NextResponse.json({
      success:   true,
      source:    "db",
      latencyMs: Date.now() - t0,
      message:   "Authentication successful using saved credentials.",
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection test failed.";
    // Don't log the full error — might reference credentials
    console.error("[POST /api/micros/test-connection] Auth test failed.");
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
