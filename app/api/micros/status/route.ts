/**
 * GET /api/micros/status
 *
 * Returns MICROS connection status summary.
 *
 * Includes:
 *  - Connection configuration status (from DB)
 *  - Feature flag state (MICROS_ENABLED env var)
 *  - Env-var configuration status (which vars are set, without values)
 *  - Last sync run details
 *  - Latest daily sales snapshot
 *
 * NEVER returns token values, client secrets, or full credential strings.
 */

import { NextResponse }         from "next/server";
import { getMicrosStatus }      from "@/services/micros/status";
import { getMicrosConfigStatus } from "@/lib/micros/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [dbStatus, cfgStatus] = await Promise.all([
      getMicrosStatus(),
      Promise.resolve(getMicrosConfigStatus()),
    ]);

    return NextResponse.json({
      ...dbStatus,
      envConfig: {
        enabled:    cfgStatus.enabled,
        configured: cfgStatus.configured,
        // Surface missing var names (no values) for debugging
        missing:    cfgStatus.missing,
        message:    cfgStatus.message,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch MICROS status." },
      { status: 500 },
    );
  }
}
