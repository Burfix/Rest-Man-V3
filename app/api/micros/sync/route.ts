/**
 * POST /api/micros/sync
 *
 * Returns 503 -- sync logic is not yet implemented.
 * Authentication is available via the PKCE flow in lib/micros/auth.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok:      false,
      status:  "not_available",
      message: "Data sync is not yet implemented. Authentication is available — sync logic is pending.",
    },
    { status: 503 },
  );
}
