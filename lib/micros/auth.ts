/**
 * lib/micros/auth.ts
 *
 * Oracle MICROS BI API -- OIDC Authorization Code flow with PKCE (RFC 7636).
 *
 * Three-step server-side flow:
 *   1. GET  {MICROS_AUTH_SERVER}/oidc-provider/v1/oauth2/authorize
 *      Sets session cookies; returns 302.
 *   2. POST {MICROS_AUTH_SERVER}/oidc-provider/v1/oauth2/signin
 *      Submits credentials + cookies; returns 302 with ?code= in Location.
 *   3. POST {MICROS_AUTH_SERVER}/oidc-provider/v1/oauth2/token
 *      Exchanges auth code + code_verifier for {access_token, id_token,
 *      refresh_token, expires_in}.
 *
 * Refresh (same token endpoint):
 *   POST {MICROS_AUTH_SERVER}/oidc-provider/v1/oauth2/token
 *   grant_type=refresh_token — silent re-auth before expiry.
 *
 * Redirect URI: apiaccount://callback
 *
 * Env vars (server-side only):
 *   MICROS_AUTH_SERVER   Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_CLIENT_ID     Registered OAuth client ID (public client, no secret)
 *   MICROS_USERNAME      Oracle BI API account username
 *   MICROS_PASSWORD      Oracle BI API account password
 */

import crypto from "crypto";
import { generateCodeVerifier, generateCodeChallenge } from "./pkce";

const AUTHORIZE_PATH = "/oidc-provider/v1/oauth2/authorize";
const SIGNIN_PATH    = "/oidc-provider/v1/oauth2/signin";
const TOKEN_PATH     = "/oidc-provider/v1/oauth2/token";
const REDIRECT_URI   = "apiaccount://callback";

const FETCH_TIMEOUT_MS = 20_000;
const TOKEN_BUFFER_MS  = 5 * 60 * 1000; // 5-min early-expiry buffer

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OracleTokenSet {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt?: number;
}

export class MicrosAuthError extends Error {
  constructor(
    public readonly stage: "authorize" | "signin" | "token" | "refresh" | "config",
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
 * Returns a valid token string (id_token preferred, falls back to access_token).
 * Silently refreshes using refresh_token when near expiry.
 * Concurrent callers share one inflight request — no thundering herd.
 */
export async function getMicrosAccessToken(): Promise<string> {
  if (_tokenSet && isTokenValid(_tokenSet)) return _tokenSet.accessToken;

  // Silent refresh when we have a refresh token that is not yet expired.
  if (_tokenSet?.refreshToken && isRefreshTokenValid(_tokenSet)) {
    if (!_inflight) {
      _inflight = doRefresh(_tokenSet.refreshToken);
    }
    try {
      _tokenSet = await _inflight;
      return _tokenSet.accessToken;
    } catch (err) {
      // Refresh failed — clear cache and fall through to full PKCE flow.
      _tokenSet = null;
      console.warn(
        "[MicrosAuth] Refresh failed; starting full PKCE flow.",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      _inflight = null;
    }
  }

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
    valid:            !!_tokenSet && isTokenValid(_tokenSet),
    expiresAt:        _tokenSet?.expiresAt ?? null,
    hasRefreshToken:  !!_tokenSet?.refreshToken,
    refreshExpiresAt: _tokenSet?.refreshExpiresAt ?? null,
  };
}

export function clearMicrosTokenCache(): void {
  _tokenSet = null;
}

// ---------------------------------------------------------------------------
// Full PKCE acquisition
// ---------------------------------------------------------------------------

async function acquireToken(): Promise<OracleTokenSet> {
  const cfg           = loadConfig();
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state         = generateState();

  const cookies = await stepAuthorize(cfg, codeChallenge, state);
  const code    = await stepSignin(cfg, cookies);
  return stepToken(cfg, code, codeVerifier);
}

// ---------------------------------------------------------------------------
// Step 1: Authorize  GET /oidc-provider/v1/oauth2/authorize
// ---------------------------------------------------------------------------

async function stepAuthorize(
  cfg: MicrosAuthConfig,
  codeChallenge: string,
  state: string,
): Promise<string> {
  const url = new URL(cfg.authServer + AUTHORIZE_PATH);
  url.searchParams.set("response_type",         "code");
  url.searchParams.set("client_id",             cfg.clientId);
  url.searchParams.set("redirect_uri",          REDIRECT_URI);
  url.searchParams.set("scope",                 "openid");
  url.searchParams.set("code_challenge",        codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state",                 state);

  const requestUrl = url.toString();
  console.log("[MICROS_AUTH_DEBUG] authorize request", {
    url:               sanitize(requestUrl),
    method:            "GET",
    client_id_length:  cfg.clientId.length,
    client_id_preview: cfg.clientId.slice(0, 6) + "..." + cfg.clientId.slice(-6),
  });

  const res = await fetchWithTimeout(requestUrl, {
    method:   "GET",
    redirect: "manual",
    headers:  { Accept: "text/html,application/json" },
  }, "authorize");

  console.log("[MICROS_AUTH_DEBUG] authorize response", {
    status:             res.status,
    contentType:        res.headers.get("content-type"),
    location_present:   !!res.headers.get("location"),
    set_cookie_present: hasCookies(res.headers),
  });

  if (res.status !== 200 && res.status !== 302 && res.status !== 303) {
    const body = await safeReadBody(res);
    throw new MicrosAuthError(
      "authorize",
      classifyError("", res.status),
      "GET " + sanitize(requestUrl) + " => " + res.status + (body ? " -- " + body : ""),
      mapReasonCode("", res.status),
    );
  }

  return extractSetCookies(res.headers);
}

// ---------------------------------------------------------------------------
// Step 2: Sign in  POST /oidc-provider/v1/oauth2/signin
// ---------------------------------------------------------------------------

async function stepSignin(cfg: MicrosAuthConfig, cookies: string): Promise<string> {
  const url  = cfg.authServer + SIGNIN_PATH;
  const body = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
  });

  console.log("[MICROS_AUTH_DEBUG] signin request", {
    url,
    method:           "POST",
    username_present: !!cfg.username,
    cookies_present:  cookies.length > 0,
  });

  const res = await fetchWithTimeout(url, {
    method:   "POST",
    redirect: "manual",
    headers:  {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "text/html,application/json",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: body.toString(),
  }, "signin");

  const location = res.headers.get("location") ?? "";
  console.log("[MICROS_AUTH_DEBUG] signin response", {
    status:           res.status,
    contentType:      res.headers.get("content-type"),
    location_present: !!location,
    code_present:     location.includes("code="),
  });

  if (res.status !== 302 && res.status !== 303) {
    const responseBody = await safeReadBody(res);
    throw new MicrosAuthError(
      "signin",
      classifyError("", res.status),
      "POST " + url + " => " + res.status + (responseBody ? " -- " + responseBody : ""),
      mapReasonCode("", res.status),
    );
  }

  const code = extractCode(location);
  if (!code) {
    throw new MicrosAuthError(
      "signin",
      "No authorization code in Oracle signin redirect",
      "Location: " + sanitize(location.slice(0, 150)),
    );
  }
  return code;
}

// ---------------------------------------------------------------------------
// Step 3: Token exchange  POST /oidc-provider/v1/oauth2/token
// ---------------------------------------------------------------------------

async function stepToken(
  cfg: MicrosAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<OracleTokenSet> {
  const url  = cfg.authServer + TOKEN_PATH;
  const body = new URLSearchParams({
    scope:         "openid",
    grant_type:    "authorization_code",
    client_id:     cfg.clientId,
    code_verifier: codeVerifier,
    code,
    redirect_uri:  REDIRECT_URI,
  });

  console.log("[MICROS_AUTH_DEBUG] token request", {
    url,
    method:            "POST",
    grant_type:        "authorization_code",
    client_id_length:  cfg.clientId.length,
    client_id_preview: cfg.clientId.slice(0, 6) + "..." + cfg.clientId.slice(-6),
    code_present:      !!code,
    verifier_present:  !!codeVerifier,
  });

  const res = await fetchWithTimeout(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    },
    body: body.toString(),
  }, "token");

  return parseTokenResponse(res, "token");
}

// ---------------------------------------------------------------------------
// Refresh flow  POST /oidc-provider/v1/oauth2/token  grant_type=refresh_token
// ---------------------------------------------------------------------------

async function doRefresh(refreshToken: string): Promise<OracleTokenSet> {
  const cfg  = loadConfig();
  const url  = cfg.authServer + TOKEN_PATH;
  const body = new URLSearchParams({
    scope:         "openid",
    grant_type:    "refresh_token",
    client_id:     cfg.clientId,
    refresh_token: refreshToken,
    redirect_uri:  REDIRECT_URI,
  });

  console.log("[MICROS_AUTH_DEBUG] refresh request", {
    url,
    method:                "POST",
    grant_type:            "refresh_token",
    client_id_length:      cfg.clientId.length,
    refresh_token_present: !!refreshToken,
  });

  const res = await fetchWithTimeout(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    },
    body: body.toString(),
  }, "refresh");

  return parseTokenResponse(res, "refresh", refreshToken);
}

// ---------------------------------------------------------------------------
// Shared token/refresh response parser
// ---------------------------------------------------------------------------

async function parseTokenResponse(
  res: Response,
  stage: "token" | "refresh",
  existingRefreshToken?: string,
): Promise<OracleTokenSet> {
  const responseText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(responseText);
  } catch {
    /* non-JSON body */
  }

  console.log("[MICROS_AUTH_DEBUG] " + stage + " response", {
    status:                res.status,
    contentType:           res.headers.get("content-type"),
    access_token_present:  !!json.access_token,
    id_token_present:      !!json.id_token,
    refresh_token_present: !!json.refresh_token,
  });

  if (!res.ok) {
    const errorCode = String(json.error ?? json.code ?? "");
    const errorMsg  = String(
      json.error_description ?? json.message ?? responseText.slice(0, 200),
    );
    console.error("[MICROS_AUTH_DEBUG] " + stage + " error", {
      status:    res.status,
      errorCode: sanitize(errorCode),
      errorMsg:  sanitize(errorMsg),
    });
    throw new MicrosAuthError(
      stage,
      classifyError(errorCode, res.status),
      sanitize(errorMsg),
      mapReasonCode(errorCode, res.status),
    );
  }

  const accessToken  = String(json.access_token ?? "");
  const idToken      = String(json.id_token ?? "");
  // Prefer id_token (contains Oracle BI claims) over access_token.
  const token        = idToken || accessToken;
  const newRefresh   = String(json.refresh_token ?? existingRefreshToken ?? "");
  const expiresIn    = Number(json.expires_in ?? 3600);
  const refreshExpIn = Number(json.refresh_expires_in ?? 0);

  if (!token) {
    throw new MicrosAuthError(
      stage,
      "No token in Oracle response",
      sanitize(responseText.slice(0, 200)),
    );
  }

  console.info(
    "[MicrosAuth] Token " +
      (stage === "refresh" ? "refreshed" : "acquired") +
      " via PKCE OIDC. Expires in " +
      Math.round(expiresIn / 60) +
      "m." +
      (newRefresh ? " Refresh token present." : ""),
  );

  return {
    accessToken:      token,
    idToken:          idToken || undefined,
    refreshToken:     newRefresh || undefined,
    expiresAt:        Date.now() + expiresIn * 1000,
    refreshExpiresAt: refreshExpIn > 0 ? Date.now() + refreshExpIn * 1000 : undefined,
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function classifyError(errorCode: string, status: number): string {
  if (status === 405) return "Oracle rejected the auth request URL or HTTP method.";
  const code = errorCode.toLowerCase();
  if (code.includes("invalid_grant"))  return "Invalid MICROS credentials";
  if (code.includes("invalid_client") || code.includes("invalid_client_id"))
    return "Client ID rejected by Oracle";
  if (code.includes("invalid_request")) return "Authentication request invalid";
  if (status === 401) return "Invalid MICROS credentials";
  if (status === 400) return "Authentication request rejected by Oracle";
  return "Authentication failed (HTTP " + status + ")";
}

function mapReasonCode(errorCode: string, status: number): string {
  if (status === 405) return "WRONG_AUTH_ENDPOINT";
  const code = errorCode.toLowerCase();
  if (code.includes("invalid_grant"))  return "INVALID_CREDENTIALS";
  if (code.includes("invalid_client") || code.includes("invalid_client_id"))
    return "INVALID_CLIENT_ID";
  if (code.includes("invalid_request")) return "INVALID_REQUEST";
  return "AUTH_FAILED";
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface MicrosAuthConfig {
  authServer:   string;
  clientId:     string;
  username:     string;
  password:     string;
  orgShortName: string;
}

function normalizeConfigValue(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

function loadConfig(): MicrosAuthConfig {
  const required: Record<string, string | undefined> = {
    MICROS_AUTH_SERVER: process.env.MICROS_AUTH_SERVER,
    MICROS_CLIENT_ID:   process.env.MICROS_CLIENT_ID,
    MICROS_USERNAME:    process.env.MICROS_USERNAME,
    MICROS_PASSWORD:    process.env.MICROS_PASSWORD,
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
  const clientId    = normalizeConfigValue(rawClientId);
  const authServer  = normalizeConfigValue(process.env.MICROS_AUTH_SERVER!).replace(/\/$/, "");
  const biServer    = normalizeConfigValue(
    process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER ?? "",
  ).replace(/\/$/, "");

  const cidHasWhitespace = rawClientId !== rawClientId.trim();
  const cidHasNewline    = /[\r\n]/.test(rawClientId);
  const cidFirstSix =
    clientId.length >= 6 ? clientId.slice(0, 6) : clientId.padEnd(6, "?").slice(0, 6);
  const cidLastSix = clientId.length >= 6 ? clientId.slice(-6) : "??????";

  let environmentMismatch = false;
  if (authServer && biServer) {
    try {
      const authSuffix = new URL(authServer).hostname.split(".").slice(-2).join(".");
      const biSuffix   = new URL(biServer).hostname.split(".").slice(-2).join(".");
      environmentMismatch = authSuffix !== biSuffix;
    } catch {
      /* malformed URL */
    }
  }

  console.log("[MICROS_AUTH_DEBUG] config loaded", {
    envVarUsed:            ["MICROS_AUTH_SERVER", "MICROS_CLIENT_ID", "MICROS_USERNAME"],
    authServer,
    biServer:              biServer || "(not set)",
    clientIdLength:        clientId.length,
    clientIdFirst6:        cidFirstSix,
    clientIdLast6:         cidLastSix,
    clientIdHasWhitespace: cidHasWhitespace,
    clientIdHasNewline:    cidHasNewline,
    orgShortName:          normalizeConfigValue(
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
    username:     normalizeConfigValue(process.env.MICROS_USERNAME!),
    password:     process.env.MICROS_PASSWORD!.trim(),
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

function isRefreshTokenValid(t: OracleTokenSet): boolean {
  if (!t.refreshToken) return false;
  if (!t.refreshExpiresAt) return true; // no expiry info — assume valid
  return t.refreshExpiresAt - Date.now() > TOKEN_BUFFER_MS;
}

function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

function extractSetCookies(headers: Headers): string {
  // getSetCookie() available in Node >=18 / undici; fall back to get()
  const all: string[] =
    (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (all.length > 0) {
    return all.map((c) => c.split(";")[0]).join("; ");
  }
  const single = headers.get("set-cookie") ?? "";
  if (!single) return "";
  return single
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .join("; ");
}

function hasCookies(headers: Headers): boolean {
  const all =
    (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return all.length > 0 || !!headers.get("set-cookie");
}

function extractCode(location: string): string {
  if (!location) return "";
  try {
    const normalized = location.startsWith("apiaccount://")
      ? location.replace("apiaccount://callback", "https://placeholder/callback")
      : location;
    return new URL(normalized).searchParams.get("code") ?? "";
  } catch {
    // Regex fallback
    const m = location.match(/[?&]code=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
}

function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s"]+/g, "<url>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .replace(/password["']?\s*[:=]\s*["']?[^\s"',}]+/gi, "password=<redacted>")
    .replace(/code=[^&\s"]{10,}/g, "code=<redacted>")
    .slice(0, 400);
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return sanitize((await res.text()).slice(0, 300));
  } catch {
    return "(unreadable body)";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  stage: MicrosAuthError["stage"] = "token",
): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MicrosAuthError(
        stage,
        "Authentication request timed out",
        "Timeout after " + FETCH_TIMEOUT_MS + "ms",
      );
    }
    throw new MicrosAuthError(
      stage,
      "Authentication request failed",
      "Network error: " + (err instanceof Error ? err.message : String(err)),
    );
  } finally {
    clearTimeout(timer);
  }
}
