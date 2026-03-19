/**
 * POST /api/micros/test-connection
 *
 * Validates that MICROS credentials can successfully authenticate.
 *
 * Priority:
 *  1. If MICROS_ENABLED=true and env vars are configured, test using
 *     MicrosAuthService (env-var credentials, in-memory token cache).
 *  2. Otherwise, fall back to saved DB credentials (legacy path).
 *
 * Returns:
 *   { success: true, source: "env" | "db", latencyMs: number }
 *   { success: false, error: string }
 *
 * NEVER returns the token, client_secret, or any credential values.
 */

import { NextRequest, NextResponse }              from "next/server";
import { createServerClient }                     from "@/lib/supabase/server";
import { isMicrosEnabled, getMicrosConfigStatus } from "@/lib/micros/config";
import { MicrosAuthService }                      from "@/services/micros/MicrosAuthService";
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
            success:  false,
            source:   "env",
            error:    cfgStatus.message,
            missing:  cfgStatus.missing,
          },
          { status: 400 },
        );
      }

      // Clear cached token to force a fresh auth round-trip
      MicrosAuthService.clearCache();
      await MicrosAuthService.getAccessToken();

      return NextResponse.json({
        success:   true,
        source:    "env",
        latencyMs: Date.now() - t0,
        message:   "Authentication successful using environment variable credentials.",
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
