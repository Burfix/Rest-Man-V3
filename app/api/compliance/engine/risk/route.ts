/**
 * GET  /api/compliance/engine/risk
 *      Returns all risk flags from v_compliance_risk.
 *      Query param: ?level=CRITICAL|WARNING|INFO
 *
 * POST /api/compliance/engine/risk  (not applicable — view is read-only)
 */
import { NextRequest, NextResponse } from "next/server";
import { getRiskFlags } from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_COMPLIANCE, "GET /api/compliance/engine/risk");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const level = req.nextUrl.searchParams.get("level") as
    | "CRITICAL"
    | "WARNING"
    | "INFO"
    | null;
  const requestedTenantId = req.nextUrl.searchParams.get("tenant_id") ?? undefined;

  // TENANT GUARD: non-super_admin may only query their own org/site
  const tenantId = ctx.role === "super_admin"
    ? requestedTenantId
    : (ctx.orgId ?? ctx.siteId);

  if (ctx.role !== "super_admin" && requestedTenantId && requestedTenantId !== tenantId) {
    return NextResponse.json({ error: "Access denied: you do not have access to this tenant" }, { status: 403 });
  }

  try {
    const rows = await getRiskFlags(
      level || tenantId ? { riskLevel: level ?? undefined, tenantId } : undefined,
    );
    return NextResponse.json({ data: rows, count: rows.length });
  } catch (err) {
    logger.error("compliance engine: getRiskFlags failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load risk flags" }, { status: 500 });
  }
}
