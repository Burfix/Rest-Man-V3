/**
 * GET /api/micros/debug/location-test
 *
 * Diagnostic endpoint for Oracle MICROS BI location reference validation.
 * Returns a structured report showing the full request/response chain for
 * both getGuestChecks and getTimeCardDetails.
 *
 * Access: super_admin, head_office only.
 * Not guarded by NODE_ENV — guarded by RBAC instead.
 * Sensitive: never expose to guest/gm roles.
 *
 * Query params:
 *   siteId           Required. UUID of the site to diagnose.
 *   overrideLocRef   Optional. Test an alternative locRef (non-production only).
 *   date             Optional. Business date YYYY-MM-DD (defaults to today).
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getMicrosConnectionBySiteId } from "@/services/micros/status";
import { getMicrosConfigStatus, getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosIdToken } from "@/lib/micros/auth";
import { logger } from "@/lib/logger";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Only super_admin / head_office may call this
const ALLOWED_ROLES = new Set(["super_admin", "head_office"]);

type ProbeResult = {
  endpoint:        string;
  locRefSent:      string;
  requestPayload:  Record<string, string>;
  httpStatus:      number | null;
  oracleResponse:  unknown;
  oracleErrorCode: string | null;
  oracleTitle:     string | null;
  oracleDetail:    string | null;
  error:           string | null;
  elapsedMs:       number | null;
};

async function probeEndpoint(
  orgIdentifier: string,
  appServer:     string,
  idToken:       string,
  endpoint:      string,
  payload:       Record<string, string>,
): Promise<ProbeResult> {
  const url = `${appServer}/bi/v1/${orgIdentifier}/${endpoint}`;
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const elapsed = Date.now() - t0;
    let parsed: unknown = null;
    let rawText = "";

    try {
      rawText  = await res.text();
      parsed   = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }

    const obj = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;

    return {
      endpoint,
      locRefSent:      payload.locRef,
      requestPayload:  payload,
      httpStatus:      res.status,
      oracleResponse:  parsed,
      oracleErrorCode: obj ? String(obj["o:errorCode"] ?? obj.errorCode ?? "") || null : null,
      oracleTitle:     obj ? String(obj.title ?? "") || null : null,
      oracleDetail:    obj
        ? String(obj.detail ?? (obj.errorDetails as Record<string, unknown>)?.error ?? "") || null
        : null,
      error:     res.ok ? null : `HTTP ${res.status}`,
      elapsedMs: elapsed,
    };
  } catch (err) {
    return {
      endpoint,
      locRefSent:      payload.locRef,
      requestPayload:  payload,
      httpStatus:      null,
      oracleResponse:  null,
      oracleErrorCode: null,
      oracleTitle:     null,
      oracleDetail:    null,
      error:     err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - t0,
    };
  }
}

export async function GET(req: NextRequest) {
  // ── Auth guard ───────────────────────────────────────────────────────────
  const guard = await apiGuard(PERMISSIONS.MANAGE_INTEGRATIONS, "GET /api/micros/debug/location-test");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!ALLOWED_ROLES.has(ctx.role)) {
    return NextResponse.json({ ok: false, message: "Forbidden: super_admin or head_office only" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const siteId          = searchParams.get("siteId") ?? ctx.siteId;
  const date            = searchParams.get("date") ?? todayISO();
  const overrideLocRef  = searchParams.get("overrideLocRef") ?? null;

  // overrideLocRef only permitted outside production
  if (overrideLocRef && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, message: "overrideLocRef is disabled in production. Use non-production environment." },
      { status: 400 },
    );
  }

  if (!ctx.siteIds.includes(siteId)) {
    return NextResponse.json({ ok: false, message: "Access denied: siteId not in your accessible sites" }, { status: 403 });
  }

  // ── Config check ─────────────────────────────────────────────────────────
  const cfgStatus = getMicrosConfigStatus();
  const cfg       = cfgStatus.configured ? getMicrosEnvConfig() : null;

  // ── Connection lookup ────────────────────────────────────────────────────
  let connection = null;
  let connectionError: string | null = null;
  try {
    connection = await getMicrosConnectionBySiteId(siteId);
  } catch (err) {
    connectionError = err instanceof Error ? err.message : String(err);
  }

  // ── locRef resolution chain ──────────────────────────────────────────────
  const dbLocRef          = connection?.loc_ref ?? null;
  const dbSalesLocRef     = (connection as Record<string, unknown> | null)?.sales_location_ref as string | null ?? null;
  const envLocRef         = cfg?.locRef ?? null;

  const effectiveLabourLocRef = dbLocRef ?? envLocRef ?? "UNKNOWN";
  const effectiveSalesLocRef  = dbSalesLocRef?.trim() || dbLocRef || envLocRef || "UNKNOWN";
  const testLocRef            = overrideLocRef ?? effectiveSalesLocRef;

  const locRefChain = {
    dbLocRef,
    dbSalesLocRef,
    envLocRef:            envLocRef ? "(set)" : null,
    effectiveLabourLocRef,
    effectiveSalesLocRef,
    testLocRef,
    overrideApplied:      !!overrideLocRef,
    locRefType:           typeof testLocRef,
    locRefIsNumericString: /^\d+$/.test(testLocRef),
  };

  // ── Token acquisition ────────────────────────────────────────────────────
  let idToken: string | null = null;
  let tokenError: string | null = null;
  let tokenMeta: Record<string, unknown> | null = null;

  if (cfgStatus.configured) {
    try {
      idToken = await getMicrosIdToken();

      // Decode JWT header/payload for diagnostics (no signature verification needed)
      try {
        const [rawHeader, rawPayload] = idToken.split(".");
        const header  = JSON.parse(Buffer.from(rawHeader,  "base64url").toString());
        const payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString());
        tokenMeta = {
          alg: header.alg,
          iss: payload.iss,
          aud: payload.aud,
          sub: payload.sub ? `${String(payload.sub).slice(0, 6)}…` : null,
          exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
          iat: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
          expiresInSeconds: payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : null,
        };
      } catch {
        tokenMeta = { note: "Could not decode JWT (non-standard format)" };
      }
    } catch (err) {
      tokenError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Oracle probes ────────────────────────────────────────────────────────
  const probes: ProbeResult[] = [];

  if (idToken && cfg) {
    const orgIdentifier = connection?.org_identifier ?? cfg.orgIdentifier;
    const appServer     = connection?.app_server_url  ?? cfg.appServer;

    // Probe 1: getGuestChecks (sales)
    probes.push(await probeEndpoint(orgIdentifier, appServer, idToken, "getGuestChecks", {
      busDt:  date,
      locRef: testLocRef,
    }));

    // Probe 2: getTimeCardDetails (labour)
    probes.push(await probeEndpoint(orgIdentifier, appServer, idToken, "getTimeCardDetails", {
      busDt:  date,
      locRef: testLocRef,
    }));

    // Probe 3: if override not already provided, also test with numeric-parsed locRef
    // to detect string-vs-number type issues
    if (!overrideLocRef && /^\d+$/.test(testLocRef)) {
      const numericLocRef = String(parseInt(testLocRef, 10)); // strips any leading zeros
      if (numericLocRef !== testLocRef) {
        probes.push(await probeEndpoint(orgIdentifier, appServer, idToken, "getGuestChecks", {
          busDt:  date,
          locRef: numericLocRef,
        }));
        probes.push(await probeEndpoint(orgIdentifier, appServer, idToken, "getTimeCardDetails", {
          busDt:  date,
          locRef: numericLocRef,
        }));
      }
    }

    logger.info("[MicrosDebug] location-test probe completed", {
      siteId,
      testLocRef,
      orgIdentifier,
      appServer:  appServer ? "(set)" : null,
      probeCount: probes.length,
      results:    probes.map(p => `${p.endpoint}: HTTP ${p.httpStatus ?? "ERR"}`),
    });
  }

  // ── Diagnosis ────────────────────────────────────────────────────────────
  const allProbesPassed = probes.length > 0 && probes.every(p => p.httpStatus === 200);
  const locRefRejected  = probes.some(p =>
    p.oracleErrorCode === "33109" || p.oracleDetail?.toLowerCase().includes("location reference"),
  );

  const diagnosis: string[] = [];
  if (!cfgStatus.enabled)          diagnosis.push("MICROS integration is disabled (MICROS_ENABLED=false).");
  if (!cfgStatus.configured)       diagnosis.push(`Missing env vars: ${cfgStatus.missing?.join(", ")}`);
  if (connectionError)             diagnosis.push(`Connection lookup error: ${connectionError}`);
  if (!connection)                 diagnosis.push("No micros_connections row found for this site.");
  if (tokenError)                  diagnosis.push(`Token acquisition failed: ${tokenError}`);
  if (locRefRejected)              diagnosis.push(`Oracle error 33109: locRef="${testLocRef}" is not recognised by tenant "${connection?.org_identifier ?? cfg?.orgIdentifier}". Check Oracle BI admin for the correct enterprise location ID.`);
  if (allProbesPassed)             diagnosis.push(`All probes passed — locRef="${testLocRef}" is valid.`);
  if (probes.length === 0 && !tokenError && cfgStatus.configured) {
    diagnosis.push("No probes run — check token/config errors above.");
  }

  return NextResponse.json({
    ok: true,
    checkedAt:       new Date().toISOString(),
    siteId,
    date,
    config: {
      enabled:        cfgStatus.enabled,
      configured:     cfgStatus.configured,
      missing:        cfgStatus.missing ?? [],
      orgIdentifier:  connection?.org_identifier ?? cfg?.orgIdentifier ?? null,
      authServer:     connection?.auth_server_url ?? cfg?.authServer ?? null,
      appServer:      connection?.app_server_url  ? "(set)" : null,
    },
    connection: connection
      ? {
          id:                connection.id,
          status:            connection.status,
          locationName:      connection.location_name,
          locRef:            connection.loc_ref,
          salesLocationRef:  (connection as Record<string, unknown>).sales_location_ref ?? null,
          orgIdentifier:     connection.org_identifier,
          lastSyncAt:        connection.last_sync_at,
          lastSyncError:     connection.last_sync_error,
        }
      : null,
    connectionError,
    locRefChain,
    token: {
      acquired: !!idToken,
      error:    tokenError,
      meta:     tokenMeta,
    },
    probes,
    diagnosis,
    allProbesPassed,
  });
}
