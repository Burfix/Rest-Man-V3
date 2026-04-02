/**
 * GET /api/brain/output
 *
 * Returns full BrainOutput for the caller's site.
 * Uses server-side 3-minute cache in runOperatingBrain().
 * Route response is no-store so invalidation can take effect immediately.
 *
 * Query params:
 *   ?siteId=  — optional override (head_office and above only)
 */

import { NextRequest, NextResponse } from "next/server";
import { runOperatingBrain } from "@/services/brain/operating-brain";
import { apiGuard } from "@/lib/auth/api-guard";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/brain/output");
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId = req.nextUrl.searchParams.get("siteId") ?? ctx.siteId;
  const date   = todayISO();

  const brain = await runOperatingBrain(siteId, date).catch(() => null);
  if (!brain) {
    return NextResponse.json(
      { error: "Brain unavailable — data sources unreachable" },
      { status: 503 },
    );
  }

  return NextResponse.json(brain, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
