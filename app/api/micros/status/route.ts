/**
 * GET /api/micros/status
 * Returns MICROS connection status summary (never exposes tokens).
 */

import { NextResponse } from "next/server";
import { getMicrosStatus } from "@/services/micros/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const status = await getMicrosStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch MICROS status." },
      { status: 500 },
    );
  }
}
