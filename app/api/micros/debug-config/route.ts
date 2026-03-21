/**
 * GET /api/micros/debug-config
 *
 * Debug-only endpoint — returns a safe summary of the current MICROS
 * environment configuration WITHOUT exposing secret values.
 *
 * Protected: only accessible by an authenticated admin user.
 * NEVER log or return the raw password, full client_id, or any token.
 */

import { NextResponse }       from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Strips CR/LF and trims — mirrors the normalization applied in auth + config. */
function norm(v: string): string {
  return v.replace(/[\r\n]/g, "").trim();
}

export async function GET() {
  // ── Auth guard ──────────────────────────────────────────────────────────
  // Only allow authenticated users with admin role.
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role via user metadata (adjust field to match your schema).
  const role = (user.user_metadata?.role as string | undefined) ??
               (user.app_metadata?.role  as string | undefined) ?? "";
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Config inspection ───────────────────────────────────────────────────
  const rawClientId  = process.env.MICROS_CLIENT_ID       ?? "";
  const clientId     = norm(rawClientId);
  const authServer   = norm(process.env.MICROS_AUTH_SERVER ?? "");
  const biServer     = norm(process.env.MICROS_BI_SERVER   ?? process.env.MICROS_APP_SERVER ?? "");
  const username     = norm(process.env.MICROS_USERNAME    ?? process.env.MICROS_API_ACCOUNT_NAME ?? "");
  const orgShortName = norm(process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? "");
  const locationRef  = norm(process.env.MICROS_LOCATION_REF   ?? process.env.MICROS_LOC_REF        ?? "");
  const password     = process.env.MICROS_PASSWORD ?? process.env.MICROS_API_ACCOUNT_PASSWORD ?? "";

  // Detect environment mismatch heuristic.
  let environmentMismatch = false;
  try {
    if (authServer && biServer) {
      const authSuffix = new URL(authServer).hostname.split(".").slice(-2).join(".");
      const biSuffix   = new URL(biServer).hostname.split(".").slice(-2).join(".");
      environmentMismatch = authSuffix !== biSuffix;
    }
  } catch { /* malformed URL */ }

  return NextResponse.json({
    // Server presence checks (no raw values)
    authServerPresent:    !!authServer,
    authServer,                          // URL is safe to show -- not a secret
    biServerPresent:      !!biServer,
    biServer:             biServer || null,

    // Client ID diagnostics -- length + masked preview only
    clientIdPresent:      !!clientId,
    clientIdLength:       clientId.length,
    clientIdFirst6:       clientId.length >= 6 ? clientId.slice(0, 6) : clientId || "(empty)",
    clientIdLast6:        clientId.length >= 6 ? clientId.slice(-6)  : "(short)",
    clientIdHasWhitespace: rawClientId !== rawClientId.trim(),
    clientIdHasNewline:   /[\r\n]/.test(rawClientId),

    // Other config presence flags
    usernamePresent:      !!username,
    orgShortNamePresent:  !!orgShortName,
    locationRefPresent:   !!locationRef,
    passwordPresent:      !!password.trim(),

    // Integration flag
    microsEnabled:        (process.env.MICROS_ENABLED ?? "false").toLowerCase() === "true",

    // Environment mismatch warning
    environmentMismatch,
    environmentMismatchWarning: environmentMismatch
      ? "MICROS configuration appears to mix values from different Oracle environments."
      : null,

    checkedAt: new Date().toISOString(),
  });
}
