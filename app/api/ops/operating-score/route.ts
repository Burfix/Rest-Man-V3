/**
 * GET /api/ops/operating-score?location_id=UUID
 *
 * Returns the operational health score (0–100) for a location.
 *
 * Query params:
 *   location_id  — UUID of the site (defaults to the primary site)
 *
 * Response shape: OperatingScore from services/ops/operatingScore.ts
 *
 * Score components:
 *   Revenue vs Target   40 pts
 *   Labour %            20 pts
 *   Compliance status   20 pts
 *   Maintenance status  20 pts
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatingScore } from "@/services/ops/operatingScore";

const DEFAULT_LOCATION_ID = "00000000-0000-0000-0000-000000000001";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get("location_id") ?? DEFAULT_LOCATION_ID;

  // Basic UUID validation — reject obviously malformed values
  if (!/^[0-9a-f-]{8,36}$/i.test(locationId)) {
    return NextResponse.json(
      { error: "Invalid location_id format" },
      { status: 400 }
    );
  }

  try {
    const score = await getOperatingScore(locationId);
    return NextResponse.json(score);
  } catch (err) {
    console.error("[GET /api/ops/operating-score]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
