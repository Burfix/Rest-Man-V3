import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getOperatingScore } from "@/services/ops/operatingScore";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/ops/operating-score");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  try {
    const score = await getOperatingScore(ctx.siteId);
    return NextResponse.json(score);
  } catch (err) {
    logger.error("Failed to get operating score", { route: "GET /api/ops/operating-score", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
