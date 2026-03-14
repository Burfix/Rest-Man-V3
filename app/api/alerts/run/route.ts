/**
 * POST /api/alerts/run
 *
 * Triggers the operational alerts engine on demand.
 * Protected by a shared secret header (ALERTS_CRON_SECRET).
 *
 * Called automatically by Vercel Cron (every 30 minutes).
 * Configure in vercel.json:
 *
 *   "crons": [
 *     {
 *       "path": "/api/alerts/run",
 *       "schedule": "*\/30 * * * *"
 *     }
 *   ]
 *
 * Vercel sets the Authorization header to "Bearer <CRON_SECRET>"
 * automatically for cron invocations when CRON_SECRET env var is set.
 *
 * For local/manual testing:
 *   curl -X POST http://localhost:3000/api/alerts/run \
 *     -H "Authorization: Bearer <ALERTS_CRON_SECRET>"
 */

import { NextResponse } from "next/server";
import { runAlertsEngine } from "@/services/alerts/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // Vercel Pro: up to 300s; Hobby: 10s

export async function POST(req: Request): Promise<NextResponse> {
  // Validate cron secret if set (skip check in development)
  const secret = process.env.ALERTS_CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runAlertsEngine();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[POST /api/alerts/run]", err);
    return NextResponse.json(
      { error: "Alerts engine failed", detail: String(err) },
      { status: 500 }
    );
  }
}
