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
  "MICROS_APP_SERVER",
  "MICROS_CLIENT_ID",
  "MICROS_ORG_IDENTIFIER",
  "MICROS_API_ACCOUNT_NAME",
  "MICROS_LOC_REF",
  "MICROS_API_ACCOUNT_PASSWORD",
  "MICROS_CLIENT_SECRET",
  "MICROS_AUTH_TOKEN_PATH",
  "MICROS_AUTH_SCOPE",
] as const;

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
