/**
 * GET  /api/compliance/engine/summary
 *      Returns per-tenant compliance summary from v_compliance_summary_by_tenant.
 *      Query param: ?tenant_id=<uuid>  (optional — omit for all tenants)
 */
import { NextRequest, NextResponse } from "next/server";
import { getTenantSummaries, getTenantSummary } from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/compliance/engine/summary");
  if (guard.error) return guard.error;
  const tenantId = req.nextUrl.searchParams.get("tenant_id");

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
