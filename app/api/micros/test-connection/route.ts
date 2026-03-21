/**
 * POST /api/micros/test-connection
 *
 * Makes a single token request to the Oracle MICROS auth server using the
 * credentials provided via environment variables.
 *
 * Request: POST {MICROS_AUTH_SERVER}/oauth/token
 * Body:    grant_type=password, username, password, client_id
 *
 * Response: { ok, status, httpStatus, contentType, requestUrl, requestMethod,
 *             responsePreview, oracleError, message }
 *
 * No fallbacks. No alternate flows. No retries.
 * NEVER returns token values, passwords, or credential content.
 */

import { NextResponse }          from "next/server";
import { clearMicrosTokenCache } from "@/lib/micros/auth";
import { createServerClient }    from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 20_000;

function statusMessage(httpStatus: number): string {
  if (httpStatus === 400) return "Oracle rejected the authentication request.";
  if (httpStatus === 401) return "Oracle rejected the username or password.";
  if (httpStatus === 403) return "Oracle accepted the request but does not allow this client/account.";
  if (httpStatus === 405) return "Oracle rejected the endpoint or HTTP method.";
  return "Oracle rejected the authentication request.";
}

export async function POST() {
  const authServer = (process.env.MICROS_AUTH_SERVER ?? "").replace(/[\r\n]/g, "").trim().replace(/\/$/, "");
  const clientId   = (process.env.MICROS_CLIENT_ID   ?? "").replace(/[\r\n]/g, "").trim();
  const username   = (process.env.MICROS_USERNAME     ?? "").replace(/[\r\n]/g, "").trim();
  const password   = (process.env.MICROS_PASSWORD     ?? "").trim();

  if (!authServer || !clientId || !username || !password) {
    const missing = (
      [
        !authServer && "MICROS_AUTH_SERVER",
        !clientId   && "MICROS_CLIENT_ID",
        !username   && "MICROS_USERNAME",
        !password   && "MICROS_PASSWORD",
      ] as Array<string | false>
    ).filter(Boolean).join(", ");
    return NextResponse.json(
      {
        ok:              false,
        status:          "not_configured",
        httpStatus:      null,
        contentType:     null,
        requestUrl:      authServer ? authServer + "/oauth/token" : null,
        requestMethod:   "POST",
        responsePreview: null,
        oracleError:     null,
        message:         `Required credentials are missing: ${missing}. Check your environment variables.`,
        checkedAt:       new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  // Single, direct token request — no retries, no fallbacks.
  const url  = authServer + "/oauth/token";
  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id:  clientId,
  });

  let res: Response;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    body.toString(),
      signal:  controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    const isTimeout  = err instanceof Error && err.name === "AbortError";
    const networkMsg = isTimeout ? "Request timed out after 20s" : (err instanceof Error ? err.message : String(err));
    const failMsg    = "Oracle auth server did not respond. " + networkMsg.slice(0, 150);
    await persistSyncError(failMsg).catch(() => null);
    return NextResponse.json(
      {
        ok:              false,
        status:          "network_error",
        httpStatus:      null,
        contentType:     null,
        requestUrl:      url,
        requestMethod:   "POST",
        responsePreview: null,
        oracleError:     null,
        message:         failMsg,
        checkedAt:       new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  const raw         = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type") ?? "";
  const preview     = sanitizePreview(raw);

  // Extract Oracle error fields from JSON responses.
  let oracleError: Record<string, string | number | null> | null = null;
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(raw);
    const pick = (key: string) => (json[key] != null ? String(json[key]) : null);
    oracleError = {
      error:             pick("error"),
      error_description: pick("error_description"),
      message:           pick("message"),
      code:              pick("code"),
      status:            json.status != null ? Number(json.status) : null,
    };
    // Nullify if all fields are empty (non-error success body).
    if (Object.values(oracleError).every((v) => v === null)) oracleError = null;
  } catch { /* non-JSON — leave oracleError null, preview covers it */ }

  if (res.ok && json.access_token) {
    clearMicrosTokenCache();
    await persistConnected().catch(() => null);
    return NextResponse.json({
      ok:              true,
      status:          "connected",
      httpStatus:      res.status,
      contentType,
      requestUrl:      url,
      requestMethod:   "POST",
      responsePreview: preview,
      oracleError:     null,
      message:         "Authentication successful.",
      checkedAt:       new Date().toISOString(),
    });
  }

  const failureMessage = statusMessage(res.status);
  await persistSyncError(failureMessage).catch(() => null);
  return NextResponse.json(
    {
      ok:              false,
      status:          "auth_failed",
      httpStatus:      res.status,
      contentType,
      requestUrl:      url,
      requestMethod:   "POST",
      responsePreview: preview,
      oracleError,
      message:         failureMessage,
      checkedAt:       new Date().toISOString(),
    },
    { status: 400 },
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sanitizePreview(raw: string): string {
  return raw
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .replace(/password["']?\s*[:=]\s*["']?[^\s"',}]+/gi, "password=<redacted>")
    .slice(0, 300);
}

async function persistConnected(): Promise<void> {
  const supabase = createServerClient();
  await supabase
    .from("micros_connections")
    .update({ status: "connected", last_sync_error: null })
    .eq("loc_ref", process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "");
}

async function persistSyncError(message: string): Promise<void> {
  const supabase = createServerClient();
  await supabase
    .from("micros_connections")
    .update({ status: "error", last_sync_error: message })
    .eq("loc_ref", process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "");
}
