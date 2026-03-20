/**
 * POST /api/micros/test-connection
 *
 * Runs the Oracle MICROS BI API password-grant auth flow and returns
 * a structured result showing exactly which stage passed or failed.
 *
 * Response shape:
 *   { ok, stage, reasonCode, message, hasIdToken, hasRefreshToken, authMs, checkedAt }
 *
 * NEVER returns token values, passwords, or credential content.
 */

import { NextResponse }           from "next/server";
import {
  clearMicrosTokenCache,
  getMicrosAccessToken,
  getMicrosTokenStatus,
  MicrosAuthError,
}                                  from "@/lib/micros/auth";
import { MicrosApiClient }         from "@/lib/micros/client";
import { createServerClient }      from "@/lib/supabase/server";
import { sanitizeMicrosError }     from "@/lib/integrations/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const t0 = Date.now();

  // Always start with a cold cache so we're testing the real flow.
  clearMicrosTokenCache();

  // ── Step 1: password grant auth flow ────────────────────────────────────
  let stage: "token" | "api" | "config" = "token";
  const authT0 = Date.now();

  try {
    await getMicrosAccessToken();
  } catch (err) {
    const authErr    = err instanceof MicrosAuthError ? err : null;
    const authStage  = authErr?.stage ?? "token";
    const userMsg    = authErr?.userMessage ?? (err instanceof Error ? err.message : "Authentication failed");
    const reasonCode = authErr?.reasonCode  ?? "AUTH_FAILED";
    const safeMsg    = sanitizeMicrosError(userMsg);

    // Persist sanitized error to DB connection record
    await persistSyncError(safeMsg).catch(() => null);

    // INVALID_CLIENT_ID — surface specific Oracle error with structured detail.
    if (reasonCode === "INVALID_CLIENT_ID") {
      return NextResponse.json(
        {
          ok:              false,
          health:          "setup_incomplete",
          reasonCode:      "INVALID_CLIENT_ID",
          userMessage:     safeMsg,
          technicalDetails: {
            stage:         authStage,
            oracleCode:    "VALIDATION_ERRORS",
            oracleMessage: "INVALID_CLIENT_ID",
          },
          hasIdToken:      false,
          hasRefreshToken: false,
          checkedAt:       new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok:              false,
        stage:           authStage,
        reasonCode,
        message:         safeMsg,
        hasIdToken:      false,
        hasRefreshToken: false,
        checkedAt:       new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const authMs  = Date.now() - authT0;
  const status  = getMicrosTokenStatus();
  stage = "api";

  // ── Step 2: Lightweight BI API health check ───────────────────────────
  const today   = todayJHB();
  const apiT0   = Date.now();
  let   apiMs   = 0;
  let   apiNote: string | undefined;

  try {
    await MicrosApiClient.get(
      process.env.MICROS_PATH_DAILY_TOTALS ?? "/reports/dailyBusinessSummary",
      { businessDate: today },
    );
    apiMs = Date.now() - apiT0;
  } catch (apiErr) {
    apiMs = Date.now() - apiT0;
    const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    // 404 = no data for today, but routing works — treat as soft pass.
    if (!msg.includes("404")) {
      apiNote = msg.slice(0, 250);
      console.warn("[POST /api/micros/test-connection] BI API warning:", msg);
    }
  }

  // ── Persist connected status ──────────────────────────────────────────
  await persistConnected().catch(() => null);

  return NextResponse.json({
    ok:              true,
    stage:           "api" as const,
    message:         "Authentication successful and BI API is reachable." +
                     (apiNote ? ` Note: ${apiNote}` : ""),
    hasIdToken:      true,
    hasRefreshToken: status.hasRefreshToken,
    authMs,
    apiMs,
    latencyMs:       Date.now() - t0,
    checkedAt:       new Date().toISOString(),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

async function persistConnected(): Promise<void> {
  const supabase = createServerClient();
  await supabase
    .from("micros_connections")
    .update({ status: "connected", last_sync_error: null })
    .eq("loc_ref", process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "");
}

async function persistSyncError(message: string): Promise<void> {
  const supabase = createServerClient();
  await supabase
    .from("micros_connections")
    .update({ status: "error", last_sync_error: message })
    .eq("loc_ref", process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "");
}
