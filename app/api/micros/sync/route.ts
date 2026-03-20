/**
 * POST /api/micros/sync
 *
 * Triggers a full sync for the pilot store.
 * Body: { businessDate?: "YYYY-MM-DD" }  (defaults to today JHB)
 *
 * When MICROS_ENABLED=true (env var), uses MicrosSyncService with live
 * Oracle MICROS BI API credentials from environment variables.
 *
 * When MICROS_ENABLED=false (default), returns a disabled status immediately
 * so the UI can show "MICROS not configured" without crashing.
 *
 * Returns the SyncResult from the orchestrator.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMicrosEnabled, getMicrosConfigStatus } from "@/lib/micros/config";
import { MicrosSyncService }         from "@/services/micros/MicrosSyncService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function POST(req: NextRequest) {
  try {
    // ── Feature flag guard ────────────────────────────────────────────────
    if (!isMicrosEnabled()) {
      const cfgStatus = getMicrosConfigStatus();
      return NextResponse.json(
        {
          success:  false,
          enabled:  false,
          message:  cfgStatus.message,
          // Surface which vars are missing (safe — no secret values)
          missing:  cfgStatus.missing,
        },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => ({})) as { businessDate?: string };
    const businessDate = body.businessDate ?? todayJHB();

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return NextResponse.json({ error: "businessDate must be YYYY-MM-DD." }, { status: 400 });
    }

    // ── Live sync via env-var credentials ────────────────────────────────
    const syncService = new MicrosSyncService();
    const result = await syncService.runFullSync(businessDate);

    const httpStatus = result.success ? 200 : 502;
    return NextResponse.json(result, { status: httpStatus });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected sync error.";
    console.error("[POST /api/micros/sync]", message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
