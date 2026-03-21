/**
 * POST /api/micros/test-connection
 *
 * Attempts the full Oracle BIAPI PKCE authentication flow:
 *   authorize → signin → token → (optional) lightweight API call
 *
 * On success: updates the micros_connections DB row to "connected".
 * On failure: returns detailed, stage-specific error info.
 */

import { NextResponse }       from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getMicrosIdToken, MicrosAuthError, clearMicrosTokenCache } from "@/lib/micros/auth";
import { getMicrosConfigStatus } from "@/lib/micros/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const cfgStatus = getMicrosConfigStatus();

  if (!cfgStatus.enabled) {
    return NextResponse.json({
      ok: false,
      status: "disabled",
      message: "MICROS integration is disabled. Set MICROS_ENABLED=true.",
      checkedAt: new Date().toISOString(),
    });
  }

  if (!cfgStatus.configured) {
    return NextResponse.json({
      ok: false,
      status: "not_configured",
      message: `Missing configuration: ${cfgStatus.missing.join(", ")}`,
      checkedAt: new Date().toISOString(),
    });
  }

  // Clear cached tokens to force a fresh auth attempt
  clearMicrosTokenCache();

  try {
    // Attempt the full PKCE flow: authorize → signin → token
    const idToken = await getMicrosIdToken();

    // If we get here, auth succeeded
    const tokenPreview = `${idToken.slice(0, 20)}...${idToken.slice(-10)}`;

    // Update DB status to "connected" and clear any stale errors
    try {
      const supabase = createServerClient();
      await supabase
        .from("micros_connections")
        .update({
          status: "connected",
          last_sync_error: null,
          last_successful_sync_at: new Date().toISOString(),
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch { /* best-effort DB update */ }

    return NextResponse.json({
      ok: true,
      status: "connected",
      message: "PKCE authentication successful. BIAPI connection verified.",
      tokenPreview,
      checkedAt: new Date().toISOString(),
    });

  } catch (err) {
    const isAuthErr = err instanceof MicrosAuthError;
    const stage     = isAuthErr ? err.stage : "unknown";
    const message   = isAuthErr ? err.userMessage : (err instanceof Error ? err.message : "Unknown error");
    const detail    = isAuthErr ? err.detail : undefined;
    const code      = isAuthErr ? err.reasonCode : undefined;

    // Persist error to DB
    try {
      const supabase = createServerClient();
      await supabase
        .from("micros_connections")
        .update({
          status: "error",
          last_sync_error: `[${stage}] ${message}`,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000");
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: false,
      status: "auth_failed",
      stage,
      message,
      detail: detail ?? null,
      code: code ?? null,
      checkedAt: new Date().toISOString(),
    }, { status: 200 }); // 200 so the UI can parse the response cleanly
  }
}
