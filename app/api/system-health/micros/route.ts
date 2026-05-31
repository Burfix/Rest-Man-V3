/**
 * GET /api/system-health/micros
 *
 * Returns MICROS health data for all sites accessible to the caller.
 * super_admin / head_office / executive / auditor → all sites.
 * gm / supervisor / area_manager → own site(s) only.
 */

import { NextResponse }        from "next/server";
import { apiGuard }            from "@/lib/auth/api-guard";
import { PERMISSIONS, MULTI_SITE_ROLES } from "@/lib/rbac/roles";
import { getMicrosHealth }     from "@/lib/system-health/getMicrosHealth";
import { logger }              from "@/lib/logger";

export const dynamic = "force-dynamic";


export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/system-health/micros");
  if (guard.error) return guard.error;

  const { ctx } = guard;

  try {
    const siteIds = MULTI_SITE_ROLES.has(ctx.role) ? "all" : [ctx.siteId];
    const payload = await getMicrosHealth(siteIds);
    return NextResponse.json(payload);
  } catch (err) {
    logger.error("Failed to fetch MICROS health", { route: "GET /api/system-health/micros", err });
    return NextResponse.json({ error: "Failed to fetch MICROS health" }, { status: 500 });
  }
}
