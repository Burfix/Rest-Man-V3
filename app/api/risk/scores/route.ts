/**
 * GET /api/risk/scores
 *
 * Returns cached zone risk scores for a site (fast — reads risk_scores table).
 * No recomputation. Use POST /api/risk/recompute to refresh.
 *
 * Query params:
 *   siteId   — UUID (required)
 *
 * Response:
 *   { zones: ZoneSummary[], computed_at: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCachedZoneSummaries } from "@/services/universal/zoneSummary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const siteId = req.nextUrl.searchParams.get("siteId");

  if (!siteId) {
    return NextResponse.json(
      { error: "siteId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const zones = await getCachedZoneSummaries(siteId);
    const computed_at =
      zones.find((z) => z.last_computed_at)?.last_computed_at ?? null;

    return NextResponse.json({ zones, computed_at });
  } catch (err) {
    console.error("[GET /api/risk/scores]", err);
    return NextResponse.json(
      { error: "Failed to fetch risk scores" },
      { status: 500 }
    );
  }
}
