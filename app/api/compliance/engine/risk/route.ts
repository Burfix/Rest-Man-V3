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

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/compliance/engine/risk");
  if (guard.error) return guard.error;
  const level = req.nextUrl.searchParams.get("level") as
    | "CRITICAL"
    | "WARNING"
    | "INFO"
    | null;

  try {
    const rows = await getRiskFlags(level ? { riskLevel: level } : undefined);
    return NextResponse.json({ data: rows, count: rows.length });
  } catch (err) {
    logger.error("compliance engine: getRiskFlags failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load risk flags" }, { status: 500 });
  }
}
