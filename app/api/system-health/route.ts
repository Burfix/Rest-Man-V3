/**
 * GET /api/system-health
 *
 * Returns the full SystemHealthPayload for the caller's site.
 * Accessible by: super_admin, head_office, executive, auditor, area_manager.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { getSystemHealth } from "@/lib/system-health/getSystemHealth";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(
    PERMISSIONS.VIEW_SYSTEM_HEALTH as any,
    "GET /api/system-health",
  );
  if (guard.error) return guard.error;

  const { ctx } = guard;

  try {
    const health = await getSystemHealth(ctx.siteId);
    return NextResponse.json(health, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error("api.system-health.get.failed", { siteId: ctx.siteId, err: String(err) });
    Sentry.captureException(err, { tags: { route: "GET /api/system-health", site_id: ctx.siteId } });
    return NextResponse.json(
      { error: "System health check failed" },
      { status: 500 },
    );
  }
}
