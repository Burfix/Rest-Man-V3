/**
 * POST /api/micros/sync
 *
 * Returns 503 -- data sync is not available.
 * The Oracle MICROS connection method has not yet been confirmed.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok:      false,
      status:  "not_available",
      message: "Data sync is not available. The Oracle MICROS connection method has not yet been confirmed.",
    },
    { status: 503 },
  );
}
