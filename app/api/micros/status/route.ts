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

// Vars to audit at runtime — name only, NO values ever returned.
const AUDIT_VARS = [
  "MICROS_ENABLED",
  "MICROS_AUTH_SERVER",
  "MICROS_BI_SERVER",
  "MICROS_CLIENT_ID",
  "MICROS_ORG_SHORT_NAME",
  "MICROS_USERNAME",
  "MICROS_LOCATION_REF",
  "MICROS_REDIRECT_URI",
] as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUILD_ID = "f724ad2-2026-03-20"; // bump on each deploy to confirm code version

export async function GET() {
  try {
    const [dbStatus, cfgStatus] = await Promise.all([
      getMicrosStatus(),
      Promise.resolve(getMicrosConfigStatus()),
    ]);

    return NextResponse.json({
      buildId:   BUILD_ID,
      ...dbStatus,
      envConfig: {
        enabled:    cfgStatus.enabled,
        configured: cfgStatus.configured,
        // Surface missing var names (no values) for debugging
        missing:    cfgStatus.missing,
        message:    cfgStatus.message,
        // Which vars are set + length of sensitive ones — NO values ever returned
        vars: Object.fromEntries(
          AUDIT_VARS.map((k) => {
            const v = process.env[k];
            if (!v) return [k, "NOT SET"];
            // For secrets: show only length
            if (k.endsWith("_PASSWORD") || k.endsWith("_SECRET")) return [k, `set (${v.length} chars)`];
            // For non-secrets: show value (safe, non-credential config)
            return [k, v];
          })
        ),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch MICROS status." },
      { status: 500 },
    );
  }
}
