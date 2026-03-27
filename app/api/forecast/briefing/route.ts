import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { todayISO } from "@/lib/utils";
import { getForecastInputs, buildGMBriefing, getMockGMBriefing } from "@/lib/forecast";
import { getSiteConfig } from "@/lib/config/site";
import type { GMBriefing } from "@/types/forecast";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/forecast/briefing");
  if (guard.error) return guard.error;

  try {
    const params = req.nextUrl.searchParams;
    const date = params.get("date") ?? todayISO();
    const forceMock = params.get("mock") === "true";

    let briefing: GMBriefing;

    if (forceMock) {
      briefing = getMockGMBriefing(date);
    } else {
      try {
        const input = await getForecastInputs(guard.ctx!.orgId ?? undefined, date);
        const cfg = await getSiteConfig(guard.ctx!.siteId);
        briefing = buildGMBriefing(input, cfg.target_labour_pct);
      } catch (inputErr) {
        logger.warn("Forecast input fetch failed, using mock", { route: "GET /api/forecast/briefing", err: inputErr });
        briefing = getMockGMBriefing(date);
      }
    }

    return NextResponse.json(briefing);
  } catch (err) {
    logger.error("Failed to generate forecast briefing", { route: "GET /api/forecast/briefing", err });
    return NextResponse.json({ error: "Failed to generate forecast briefing" }, { status: 500 });
  }
}
