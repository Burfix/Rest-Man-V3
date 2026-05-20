/**
 * GET /api/system-health/reliability-trend
 *
 * Returns per-day reliability history for the caller's site.
 * Window: last 14 days (configurable via ?days=N, max 30).
 *
 * Used by ReliabilityTrendCard on the system-health page.
 *
 * Access: super_admin | head_office | executive | auditor | area_manager | gm
 */

import { NextResponse }                  from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { computeReliabilityTrend }       from "@/lib/reliability/trend";
import { logger }                        from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_DAYS = 30;
const DEFAULT_DAYS = 14;

export async function GET(req: Request) {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  const { searchParams } = new URL(req.url);
  const raw  = Number(searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_DAYS) : DEFAULT_DAYS;

  try {
    const trend = await computeReliabilityTrend(ctx.siteId, days);
    return NextResponse.json(trend, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error("api.reliability-trend.failed", { siteId: ctx.siteId, err: String(err) });
    return NextResponse.json(
      { ok: false, error: "Failed to compute reliability trend" },
      { status: 500 },
    );
  }
}
