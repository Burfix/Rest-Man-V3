/**
 * GET /api/forecast/briefing — Generate today's GM Co-Pilot briefing
 *
 * Query params:
 *   ?date=YYYY-MM-DD   (optional, defaults to today)
 *   ?mock=true          (optional, force mock data)
 *
 * Returns a complete GMBriefing JSON payload.
 */

import { NextRequest, NextResponse } from "next/server";
import { todayISO } from "@/lib/utils";
import { getForecastInputs, buildGMBriefing, getMockGMBriefing } from "@/lib/forecast";
import { getSiteConfig } from "@/lib/config/site";
import type { GMBriefing } from "@/types/forecast";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const params = req.nextUrl.searchParams;
    const date = params.get("date") ?? todayISO();
    const forceMock = params.get("mock") === "true";

    let briefing: GMBriefing;

    if (forceMock) {
      briefing = getMockGMBriefing(date);
    } else {
      try {
        const input = await getForecastInputs(undefined, date);
        const cfg = await getSiteConfig();
        briefing = buildGMBriefing(input, cfg.target_labour_pct);
      } catch (inputErr) {
        // Fallback to mock if real data fetch fails
        console.error("[forecast/briefing] Input fetch failed, using mock:", inputErr);
        briefing = getMockGMBriefing(date);
      }
    }

    return NextResponse.json(briefing);
  } catch (err) {
    console.error("[forecast/briefing]", err);
    return NextResponse.json(
      { error: "Failed to generate forecast briefing" },
      { status: 500 },
    );
  }
}
