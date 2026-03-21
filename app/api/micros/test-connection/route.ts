/**
 * POST /api/micros/test-connection
 *
 * Safe stub -- no connection attempt is made.
 * Returns a "not_attempted" response until Oracle confirms the supported
 * authentication method for this integration.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({
    ok:         false,
    status:     "not_attempted",
    message:    "No connection test has been run because the exact Oracle-supported authentication method has not yet been confirmed.",
    checkedAt:  new Date().toISOString(),
  });
}
