/**
 * lib/micros/auth.ts
 *
 * Oracle MICROS BI API -- OAuth 2.0 Resource Owner Password Credentials grant.
 *
 * Single request:
 *   POST {MICROS_AUTH_SERVER}/oauth/token
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: grant_type=password&username=...&password=...&client_id=...
 *
 * No client_secret. No PKCE. No cookies. No redirects.
 *
 * Env vars (server-side only):
 *   MICROS_AUTH_SERVER   Oracle auth server base URL (no trailing slash)
 *   MICROS_CLIENT_ID     Registered OAuth client ID
 *   MICROS_USERNAME      Oracle BI API account username
 *   MICROS_PASSWORD      Oracle BI API account password
 */

const TOKEN_PATH = "/oauth/token";
const FETCH_TIMEOUT_MS = 20_000;
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OracleTokenSet {
  accessToken: string;
  expiresAt: number;
}

export class MicrosAuthError extends Error {
  constructor(
    public readonly stage: "token" | "config",
    public readonly userMessage: string,
    public readonly detail?: string,
    public readonly reasonCode?: string,
  ) {
    super(
      "[MicrosAuth:" +
        stage +
        "] " +
        userMessage +
        (detail ? " -- " + detail : ""),
    );
    this.name = "MicrosAuthError";
  }
}

// ---------------------------------------------------------------------------
// In-memory token cache
// ---------------------------------------------------------------------------

let _tokenSet: OracleTokenSet | null = null;
let _inflight: Promise<OracleTokenSet> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid access_token string.
 * Serves from cache when valid; re-authenticates when expired.
 * Concurrent callers share one inflight request (no thundering herd).
 */
export async function getMicrosAccessToken(): Promise<string> {
  if (_tokenSet && isTokenValid(_tokenSet)) return _tokenSet.accessToken;
  if (_inflight) return (await _inflight).accessToken;
  _inflight = acquireToken();
  try {
    _tokenSet = await _inflight;
    return _tokenSet.accessToken;
  } finally {
    _inflight = null;
  }
}

/** @deprecated Use getMicrosAccessToken() */
export async function getMicrosIdToken(): Promise<string> {
  return getMicrosAccessToken();
}

export function getMicrosTokenStatus(): {
  valid: boolean;
  expiresAt: number | null;
  hasRefreshToken: boolean;
  refreshExpiresAt: number | null;
} {
  return {
    valid: !!_tokenSet && isTokenValid(_tokenSet),
    expiresAt: _tokenSet?.expiresAt ?? null,
    hasRefreshToken: false,
    refreshExpiresAt: null,
  };
}

export function clearMicrosTokenCache(): void {
  _tokenSet = null;
}

// ---------------------------------------------------------------------------
// Internal: token acquisition
// ---------------------------------------------------------------------------

async function acquireToken(): Promise<OracleTokenSet> {
  const cfg = loadConfig();

  const body = new URLSearchParams({
    grant_type: "password",
    username: cfg.username,
    password: cfg.password,
    client_id: cfg.clientId,
  });

  const url = cfg.authServer + TOKEN_PATH;

  console.log("[MICROS_AUTH_DEBUG] token request", {
    url,
    grant_type: "password",
    client_id_length: cfg.clientId.length,
    client_id_preview:
      cfg.clientId.slice(0, 6) + "..." + cfg.clientId.slice(-6),
    username_present: !!cfg.username,
  });

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const responseText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(responseText);
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const errorCode = String(json.error ?? json.code ?? "");
    const errorMsg = String(
      json.error_description ?? json.message ?? responseText.slice(0, 200),
    );
    console.error("[MICROS_AUTH_DEBUG] token error", {
      status: res.status,
      errorCode: sanitize(errorCode),
      errorMsg: sanitize(errorMsg),
    });
    throw new MicrosAuthError(
      "token",
      classifyError(errorCode, res.status),
      sanitize(errorMsg),
      mapReasonCode(errorCode),
    );
  }

  const accessToken = String(json.access_token ?? "");
  const expiresIn = Number(json.expires_in ?? 3600);

  if (!accessToken) {
    throw new MicrosAuthError(
      "token",
      "No access_token in Oracle response",
      sanitize(responseText.slice(0, 200)),
    );
  }

  console.info(
    "[MicrosAuth] Token acquired via password grant. Expires in " +
      Math.round(expiresIn / 60) +
      "m.",
  );
  return { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifyError(errorCode: string, status: number): string {
  const code = errorCode.toLowerCase();
  if (code.includes("invalid_grant")) return "Invalid MICROS credentials";
  if (code.includes("invalid_client") || code.includes("invalid_client_id"))
    return "Client ID rejected by Oracle";
  if (code.includes("invalid_request")) return "Authentication request invalid";
  if (status === 401) return "Invalid MICROS credentials";
  if (status === 400) return "Authentication request rejected by Oracle";
  return "Authentication failed (HTTP " + status + ")";
}

function mapReasonCode(errorCode: string): string {
  const code = errorCode.toLowerCase();
  if (code.includes("invalid_grant")) return "INVALID_CREDENTIALS";
  if (code.includes("invalid_client") || code.includes("invalid_client_id"))
    return "INVALID_CLIENT_ID";
  if (code.includes("invalid_request")) return "INVALID_REQUEST";
  return "AUTH_FAILED";
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

interface MicrosAuthConfig {
  authServer: string;
  clientId: string;
  username: string;
  password: string;
  orgShortName: string;
}

function normalizeConfigValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function loadConfig(): MicrosAuthConfig {
  const required: Record<string, string | undefined> = {
    MICROS_AUTH_SERVER: process.env.MICROS_AUTH_SERVER,
    MICROS_CLIENT_ID: process.env.MICROS_CLIENT_ID,
    MICROS_USERNAME: process.env.MICROS_USERNAME,
    MICROS_PASSWORD: process.env.MICROS_PASSWORD,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new MicrosAuthError(
      "config",
      "Integration not fully configured",
      "Missing env vars: " + missing.join(", "),
    );
  }

  const rawClientId = process.env.MICROS_CLIENT_ID!;
  const clientId = normalizeConfigValue(rawClientId);
  const authServer = normalizeConfigValue(process.env.MICROS_AUTH_SERVER!).replace(/\/$/, "");
  const biServer = normalizeConfigValue(
    process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER ?? "",
  ).replace(/\/$/, "");

  const cidHasWhitespace = rawClientId !== rawClientId.trim();
  const cidHasNewline = /[\r\n]/.test(rawClientId);
  const cidFirstSix =
    clientId.length >= 6
      ? clientId.slice(0, 6)
      : clientId.padEnd(6, "?").slice(0, 6);
  const cidLastSix = clientId.length >= 6 ? clientId.slice(-6) : "??????";

  let environmentMismatch = false;
  if (authServer && biServer) {
    try {
      const authSuffix = new URL(authServer).hostname.split(".").slice(-2).join(".");
      const biSuffix = new URL(biServer).hostname.split(".").slice(-2).join(".");
      environmentMismatch = authSuffix !== biSuffix;
    } catch {
      /* malformed URL */
    }
  }

  console.log("[MICROS_AUTH_DEBUG] config loaded", {
    envVarUsed: ["MICROS_AUTH_SERVER", "MICROS_CLIENT_ID", "MICROS_USERNAME"],
    authServer,
    biServer: biServer || "(not set)",
    clientIdLength: clientId.length,
    clientIdFirst6: cidFirstSix,
    clientIdLast6: cidLastSix,
    clientIdHasWhitespace: cidHasWhitespace,
    clientIdHasNewline: cidHasNewline,
    orgShortName: normalizeConfigValue(
      process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? "",
    ),
    environmentMismatch,
  });

  if (environmentMismatch) {
    console.warn(
      "[MICROS_AUTH_DEBUG] ENVIRONMENT_MISMATCH detected -- authServer and BI server belong to different Oracle environments.",
    );
  }

  return {
    authServer,
    clientId,
    username: normalizeConfigValue(process.env.MICROS_USERNAME!),
    password: process.env.MICROS_PASSWORD!.trim(),
    orgShortName: normalizeConfigValue(
      process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? "",
    ),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTokenValid(t: OracleTokenSet): boolean {
  return t.accessToken.length > 0 && t.expiresAt - Date.now() > TOKEN_BUFFER_MS;
}

function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s"]+/g, "<url>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .replace(/password["']?\s*[:=]\s*["']?[^\s"',}]+/gi, "password=<redacted>")
    .slice(0, 400);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MicrosAuthError(
        "token",
        "Authentication request timed out",
        "Timeout after " + FETCH_TIMEOUT_MS + "ms",
      );
    }
    throw new MicrosAuthError(
      "token",
      "Authentication request failed",
      "Network error: " + (err instanceof Error ? err.message : String(err)),
    );
  } finally {
    clearTimeout(timer);
  }
}
