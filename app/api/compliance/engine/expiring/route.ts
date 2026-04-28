/**
 * GET /api/compliance/engine/expiring
 *     Returns certs expiring within 90 days (from v_compliance_expiring_soon).
 *     Query param: ?window=30_DAYS|60_DAYS|90_DAYS
 */
import { NextRequest, NextResponse } from "next/server";
import { getExpiringSoon } from "@/lib/compliance/queries";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/compliance/engine/expiring");
  if (guard.error) return guard.error;
  const window = req.nextUrl.searchParams.get("window") as
    | "30_DAYS"
    | "60_DAYS"
    | "90_DAYS"
    | null;

  try {
    const rows = await getExpiringSoon(window ?? undefined);
    return NextResponse.json({ data: rows, count: rows.length });
  } catch (err) {
    logger.error("compliance engine: getExpiringSoon failed", { err: String(err) });
    return NextResponse.json({ error: "Failed to load expiring certificates" }, { status: 500 });
  }
}
