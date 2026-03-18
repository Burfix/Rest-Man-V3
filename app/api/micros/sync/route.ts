/**
 * POST /api/micros/sync
 *
 * Triggers a full sync for the pilot connection.
 * Body: { businessDate?: "YYYY-MM-DD" }  (defaults to today JHB)
 *
 * Returns the SyncResult from the orchestrator.
 */

import { NextRequest, NextResponse } from "next/server";
import { runFullSync }               from "@/services/micros/sync";
import { getMicrosConnection }       from "@/services/micros/status";

export const dynamic = "force-dynamic";

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { businessDate?: string };
    const businessDate = body.businessDate ?? todayJHB();

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      return NextResponse.json({ error: "businessDate must be YYYY-MM-DD." }, { status: 400 });
    }

    const connection = await getMicrosConnection();
    if (!connection) {
      return NextResponse.json({ error: "No MICROS connection configured." }, { status: 404 });
    }
    if (!connection.auth_server_url || !connection.app_server_url || !connection.client_id) {
      return NextResponse.json(
        { error: "MICROS connection is incomplete. Configure all fields in Settings → Integrations." },
        { status: 400 },
      );
    }

    const result = await runFullSync(connection, businessDate);
    const status = result.success ? 200 : 502;
    return NextResponse.json(result, { status });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected sync error." },
      { status: 500 },
    );
  }
}
