/**
 * GET  /api/compliance/engine/summary
 *      Returns per-tenant compliance summary from v_compliance_summary_by_tenant.
 *      Query param: ?tenant_id=<uuid>  (optional — omit for all tenants)
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSummaries, getTenantSummary } from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_COMPLIANCE, "GET /api/compliance/engine/summary");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  // TENANT GUARD: restrict to caller's own org unless super_admin
  const requestedTenantId = req.nextUrl.searchParams.get("tenant_id");
  const tenantId = requestedTenantId ?? ctx.orgId ?? ctx.siteId;

  // Non-super_admin callers may only query their own org/site
  if (ctx.role !== "super_admin") {
    const allowed = ctx.orgId
      ? requestedTenantId === null || requestedTenantId === ctx.orgId
      : requestedTenantId === null || ctx.siteIds.includes(requestedTenantId ?? "");
    if (!allowed) {
      return NextResponse.json({ error: "Access denied: you do not have access to this tenant" }, { status: 403 });
    }
  }

  try {
    if (tenantId) {
      const row = await getTenantSummary(tenantId);
      if (!row) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
      return NextResponse.json({ data: row });
    }

    const rows = await getTenantSummaries();
    return NextResponse.json({ data: rows, count: rows.length });
  } catch (err) {
    logger.error("compliance engine: getTenantSummaries failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load compliance summary" }, { status: 500 });
  }
}
