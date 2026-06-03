/**
 * GET /api/admin/adoption/analytics
 *
 * Returns the full Platform Adoption Analytics payload.
 * Restricted to super_admin only.
 *
 * Response shape:
 *   { data: PlatformAdoptionAnalytics, error: null }
 *   { data: null, error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { computePlatformAnalytics } from "@/lib/adoption/scores";
import { logger } from "@/lib/logger";

export const dynamic   = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await apiGuard(PERMISSIONS.VIEW_AUDIT_LOG, "GET /api/admin/adoption/analytics");
  if (guard.error) return guard.error as unknown as NextResponse;

  const { ctx } = guard;

  // Hard gate: this endpoint is super_admin only
  if (ctx.role !== "super_admin") {
    return NextResponse.json(
      { data: null, error: "Access denied — super_admin only" },
      { status: 403 },
    );
  }

  try {
    const analytics = await computePlatformAnalytics();

    logger.info("adoption.analytics: computed", {
      userId:      ctx.userId,
      userCount:   analytics.userEngagement.length,
      champions:   analytics.champions.length,
      atRisk:      analytics.atRiskUsers.length,
      adoptionPct: analytics.adoptionScore.score,
    });

    return NextResponse.json({ data: analytics, error: null });
  } catch (err: unknown) {
    logger.error("adoption.analytics: computation failed", {
      userId: ctx.userId,
      err:    String(err),
    });

    return NextResponse.json(
      { data: null, error: "Failed to compute analytics" },
      { status: 500 },
    );
  }
}
