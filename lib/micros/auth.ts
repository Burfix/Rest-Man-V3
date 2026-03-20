/**
 * lib/micros/auth.ts
 *
 * Oracle MICROS BI API — Authorization Code + PKCE auth flow.
 *
 * Three-step flow (no client_secret, no password grant):
 *
 *   A. AUTHORIZE  — GET  /oidc-provider/v1/oauth2/authorize
 *                   Obtains a session cookie + PKCE challenge registered.
 *
 *   B. SIGN IN    — POST /oidc-provider/v1/oauth2/signin
 *                   Authenticates the BIAPI account (username + password + orgname).
 *                   Returns a redirectUrl containing ?code=...
 *
 *   C. TOKEN      — POST /oidc-provider/v1/oauth2/token
 *                   Exchanges the auth code + verifier for id_token / refresh_token.
 *
 * Tokens stored in process memory only.
 * Refresh flow uses the stored refresh_token; falls back to full PKCE re-auth.
 *
 * Env vars (all server-side — never expose to browser):
 *   MICROS_AUTH_SERVER      Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_CLIENT_ID        Registered OAuth client ID
 *   MICROS_USERNAME         BIAPI account username  (e.g. SCS_THAMSANQA_BIAPI)
 *   MICROS_PASSWORD         BIAPI account password
 *   MICROS_ORG_SHORT_NAME   Oracle enterprise short name  (e.g. SCS)
 *   MICROS_REDIRECT_URI     Registered redirect URI  (e.g. apiaccount://callback)
 *
 * Security rules:
 *   - Password is read from env only, never logged, never returned to client.
 *   - Tokens live in process memory only.
 *   - All log lines use sanitize() — no secrets, no raw tokens.
 */

import { generateCodeVerifier, generateCodeChallenge } from "./pkce";

// ── Constants ─────────────────────────────────────────────────────────────

const AUTHORIZE_PATH = "/oidc-provider/v1/oauth2/authorize";
const SIGNIN_PATH    = "/oidc-provider/v1/oauth2/signin";
const TOKEN_PATH     = "/oidc-provider/v1/oauth2/token";

const FETCH_TIMEOUT_MS = 20_000;

/**
 * id_token treated as expired this many ms before actual expiry.
 * Oracle issues 14-day id_tokens; refresh at ~13 days to stay safe.
 */
const TOKEN_BUFFER_MS = 60 * 60 * 1000; // 1 hour

/** Refresh token validity. Oracle issues 28-day refresh tokens. */
const REFRESH_EXPIRY_MS = 28 * 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────

export interface OracleTokenSet {
  idToken:      string;
  refreshToken: string;
  expiresAt:    number; // unix ms — when idToken expires
  refreshExpiresAt: number; // unix ms — when refreshToken expires
}

/** Structured failure — carries the stage that failed + a user-safe message. */
export class MicrosAuthError extends Error {
  constructor(
    public readonly stage: "authorize" | "signin" | "token" | "refresh" | "config",
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(`[MicrosAuth:${stage}] ${userMessage}${detail ? ` — ${detail}` : ""}`);
    this.name = "MicrosAuthError";
  }
}

// ── In-memory token store ─────────────────────────────────────────────────

let _tokenSet: OracleTokenSet | null = null;
let _inflight: Promise<OracleTokenSet> | null = null;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns a valid id_token string.
 * Serves from cache when valid, refreshes with refresh_token when close to
 * expiry, re-runs full PKCE flow when refresh fails or is unavailable.
 * Concurrent callers share one inflight request — no thundering herd.
 */
export async function getMicrosIdToken(): Promise<string> {
  if (_tokenSet && isIdTokenValid(_tokenSet)) {
    return _tokenSet.idToken;
  }

  if (_inflight) return (await _inflight).idToken;

  _inflight = acquireTokenSet();
  try {
    _tokenSet = await _inflight;
    return _tokenSet.idToken;
  } finally {
    _inflight = null;
  }
}

/** Returns current token metadata — safe to surface in settings UI. */
export function getMicrosTokenStatus(): {
  valid: boolean;
  expiresAt: number | null;
  hasRefreshToken: boolean;
  refreshExpiresAt: number | null;
} {
  return {
    valid:            !!_tokenSet && isIdTokenValid(_tokenSet),
    expiresAt:        _tokenSet?.expiresAt        ?? null,
    hasRefreshToken:  !!_tokenSet?.refreshToken,
    refreshExpiresAt: _tokenSet?.refreshExpiresAt ?? null,
  };
}

/** Clears the in-memory token cache. Call before a fresh test. */
export function clearMicrosTokenCache(): void {
  _tokenSet = null;
}

// ── Token acquisition ─────────────────────────────────────────────────────

async function acquireTokenSet(): Promise<OracleTokenSet> {
  // Try refresh_token path first — cheaper, no password re-transmission.
  if (_tokenSet?.refreshToken && isRefreshTokenValid(_tokenSet)) {
    try {
      const refreshed = await executeRefreshGrant(_tokenSet.refreshToken);
      console.info("[MicrosAuth] Token refreshed via refresh_token grant.");
      return refreshed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MicrosAuth] Refresh failed — falling back to full PKCE flow. ${sanitize(msg)}`);
    }
  }

  // Full PKCE auth flow.
  console.info("[MicrosAuth] Starting full PKCE authorization flow.");
  return executePkceFlow();
}

// ── PKCE flow ─────────────────────────────────────────────────────────────

async function executePkceFlow(): Promise<OracleTokenSet> {
  const cfg = loadConfig();

  // Step A: Authorize — get session cookie + register code challenge.
  const { sessionCookies, codeVerifier } = await stepAuthorize(cfg);

  // Step B: Sign in — authenticate BIAPI account, get auth code.
  const authCode = await stepSignIn(cfg, sessionCookies);

  // Step C: Token exchange — code + verifier → tokens.
  const tokens = await stepToken(cfg, authCode, codeVerifier, sessionCookies);

  return tokens;
}

// ── Step A: Authorize ─────────────────────────────────────────────────────

async function stepAuthorize(
  cfg: MicrosAuthConfig,
): Promise<{ sessionCookies: string; codeVerifier: string }> {
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type:          "code",
    client_id:              cfg.clientId,
    scope:                  "openid",
    redirect_uri:           cfg.redirectUri,
    code_challenge:         codeChallenge,
    code_challenge_method:  "S256",
  });

  const url = `${cfg.authServer}${AUTHORIZE_PATH}?${params.toString()}`;

  console.log(
    "[MicrosAuth:authorize] GET authorize\n" +
    `  url:            ${cfg.authServer}${AUTHORIZE_PATH}\n` +
    `  client_id:      ${mask(cfg.clientId)}\n` +
    `  redirect_uri:   ${cfg.redirectUri}\n` +
    `  challenge_method: S256`,
  );

  const res = await fetchWithTimeout(url, {
    method:   "GET",
    redirect: "manual", // Oracle redirects; we want the cookies, not the redirect
    headers:  { "Accept": "text/html,application/json" },
  }, "authorize");

  // Collect Set-Cookie headers — required for subsequent requests.
  const cookies = extractCookies(res);
  if (!cookies) {
    throw new MicrosAuthError(
      "authorize",
      "PKCE sign-in session failed",
      "No session cookies returned from authorize endpoint",
    );
  }

  console.log(`[MicrosAuth:authorize] OK — ${cookies.split(";").length} cookie segments`);
  return { sessionCookies: cookies, codeVerifier };
}

// ── Step B: Sign in ───────────────────────────────────────────────────────

async function stepSignIn(cfg: MicrosAuthConfig, sessionCookies: string): Promise<string> {
  const body = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
    orgname:  cfg.orgShortName,
  });

  console.log(
    "[MicrosAuth:signin] POST signin\n" +
    `  url:      ${cfg.authServer}${SIGNIN_PATH}\n` +
    `  username: ${mask(cfg.username)}\n` +
    `  orgname:  ${cfg.orgShortName}`,
    // password is NEVER logged
  );

  const res = await fetchWithTimeout(`${cfg.authServer}${SIGNIN_PATH}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie":       sessionCookies,
      "Accept":       "application/json",
    },
    body: body.toString(),
  }, "signin");

  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new MicrosAuthError(
      "signin",
      classifySignInError(res.status, detail),
      sanitize(detail),
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new MicrosAuthError("signin", "PKCE sign-in session failed", "Response was not JSON");
  }

  const redirectUrl = (json as Record<string, unknown>)?.redirectUrl as string | undefined;
  if (!redirectUrl) {
    throw new MicrosAuthError(
      "signin",
      "PKCE sign-in session failed",
      `No redirectUrl in signin response. Body: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }

  const code = extractAuthCode(redirectUrl, cfg.redirectUri);
  if (!code) {
    throw new MicrosAuthError(
      "signin",
      "PKCE sign-in session failed",
      `Could not extract ?code= from redirectUrl: ${sanitize(redirectUrl)}`,
    );
  }

  console.log("[MicrosAuth:signin] OK — auth code obtained.");
  return code;
}

// ── Step C: Token exchange ────────────────────────────────────────────────

async function stepToken(
  cfg:            MicrosAuthConfig,
  code:           string,
  codeVerifier:   string,
  sessionCookies: string,
): Promise<OracleTokenSet> {
  const body = new URLSearchParams({
    scope:         "openid",
    grant_type:    "authorization_code",
    client_id:     cfg.clientId,
    code_verifier: codeVerifier,
    code,
    redirect_uri:  cfg.redirectUri,
  });

  console.log(
    "[MicrosAuth:token] POST token\n" +
    `  url:          ${cfg.authServer}${TOKEN_PATH}\n` +
    `  grant_type:   authorization_code\n` +
    `  redirect_uri: ${cfg.redirectUri}`,
  );

  const res = await fetchWithTimeout(`${cfg.authServer}${TOKEN_PATH}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie":       sessionCookies,
      "Accept":       "application/json",
      "x-requested-by": "Oracle",
    },
    body: body.toString(),
  }, "token");

  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new MicrosAuthError(
      "token",
      classifyTokenError(res.status, detail),
      sanitize(detail),
    );
  }

  const json = await res.json() as {
    id_token?:     string;
    refresh_token?: string;
    expires_in?:   number;
    access_token?: string;
    token_type?:   string;
  };

  // Oracle BIAPI returns id_token (not access_token) — use it as bearer.
  const idToken = json.id_token ?? json.access_token;
  if (!idToken) {
    throw new MicrosAuthError("token", "Client ID rejected by Oracle", "No id_token in token response");
  }
  if (!json.refresh_token) {
    throw new MicrosAuthError("token", "Client ID rejected by Oracle", "No refresh_token in token response");
  }

  const expiresIn = json.expires_in ?? 14 * 24 * 60 * 60; // default 14 days
  console.info(
    `[MicrosAuth:token] Tokens obtained. id_token expires in ${Math.round(expiresIn / 3600)}h.`,
  );

  return {
    idToken,
    refreshToken: json.refresh_token,
    expiresAt:       Date.now() + expiresIn * 1000,
    refreshExpiresAt: Date.now() + REFRESH_EXPIRY_MS,
  };
}

// ── Refresh grant ─────────────────────────────────────────────────────────

async function executeRefreshGrant(refreshToken: string): Promise<OracleTokenSet> {
  const cfg  = loadConfig();
  const body = new URLSearchParams({
    scope:         "openid",
    grant_type:    "refresh_token",
    client_id:     cfg.clientId,
    refresh_token: refreshToken,
    redirect_uri:  cfg.redirectUri,
  });

  const res = await fetchWithTimeout(`${cfg.authServer}${TOKEN_PATH}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept":       "application/json",
      "x-requested-by": "Oracle",
    },
    body: body.toString(),
  }, "refresh");

  if (!res.ok) {
    const detail = await readErrorBody(res);
    throw new MicrosAuthError("refresh", "Refresh token rejected", sanitize(detail));
  }

  const json = await res.json() as {
    id_token?:     string;
    refresh_token?: string;
    expires_in?:   number;
    access_token?: string;
  };

  const idToken = json.id_token ?? json.access_token;
  if (!idToken) throw new MicrosAuthError("refresh", "Refresh token rejected", "No id_token returned");

  const expiresIn = json.expires_in ?? 14 * 24 * 60 * 60;
  return {
    idToken,
    refreshToken:    json.refresh_token ?? refreshToken,
    expiresAt:       Date.now() + expiresIn * 1000,
    refreshExpiresAt: Date.now() + REFRESH_EXPIRY_MS,
  };
}

// ── Config loader ─────────────────────────────────────────────────────────

interface MicrosAuthConfig {
  authServer:   string;
  clientId:     string;
  username:     string;
  password:     string;
  orgShortName: string;
  redirectUri:  string;
}

function loadConfig(): MicrosAuthConfig {
  const required: Record<string, string | undefined> = {
    MICROS_AUTH_SERVER:    process.env.MICROS_AUTH_SERVER,
    MICROS_CLIENT_ID:      process.env.MICROS_CLIENT_ID,
    MICROS_USERNAME:       process.env.MICROS_USERNAME,
    MICROS_PASSWORD:       process.env.MICROS_PASSWORD,
    MICROS_ORG_SHORT_NAME: process.env.MICROS_ORG_SHORT_NAME,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new MicrosAuthError(
      "config",
      "Integration not fully configured",
      `Missing env vars: ${missing.join(", ")}`,
    );
  }

  return {
    authServer:   (process.env.MICROS_AUTH_SERVER!).replace(/\/$/, ""),
    clientId:      process.env.MICROS_CLIENT_ID!,
    username:      process.env.MICROS_USERNAME!,
    password:      process.env.MICROS_PASSWORD!,
    orgShortName:  process.env.MICROS_ORG_SHORT_NAME!,
    redirectUri:   process.env.MICROS_REDIRECT_URI ?? "apiaccount://callback",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function isIdTokenValid(t: OracleTokenSet): boolean {
  return t.idToken.length > 0 && t.expiresAt - Date.now() > TOKEN_BUFFER_MS;
}

function isRefreshTokenValid(t: OracleTokenSet): boolean {
  return t.refreshToken.length > 0 && t.refreshExpiresAt - Date.now() > TOKEN_BUFFER_MS;
}

/**
 * Collects all Set-Cookie headers from a response into a single Cookie string
 * for use in subsequent requests.
 */
function extractCookies(res: Response): string {
  // Node.js fetch (undici) exposes Set-Cookie via getSetCookie when available,
  // otherwise falls back to iterating the raw headers.
  const raw: string[] = [];

  if (typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function") {
    raw.push(...((res.headers as { getSetCookie: () => string[] }).getSetCookie()));
  } else {
    res.headers.forEach((value, name) => {
      if (name.toLowerCase() === "set-cookie") raw.push(value);
    });
  }

  // Each entry is "name=value; Path=...; HttpOnly" — keep only "name=value" parts.
  return raw
    .map((h) => h.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Extracts the `code` query parameter from the Oracle redirect URI.
 * e.g. apiaccount://callback?code=abc123  →  "abc123"
 */
function extractAuthCode(redirectUrl: string, redirectUri: string): string | null {
  try {
    // The redirectUrl may use a custom scheme (apiaccount://).
    // Replace the custom scheme with https:// so URL() can parse it.
    const base    = redirectUri.replace(/^[^:]+:\/\//, "https://");
    const full    = redirectUrl.replace(/^[^:]+:\/\//, "https://");
    const parsed  = new URL(full, base);
    return parsed.searchParams.get("code");
  } catch {
    // Fallback: simple regex
    const m = /[?&]code=([^&]+)/.exec(redirectUrl);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return `HTTP ${res.status} ${res.statusText}`;
  }
}

function classifySignInError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 401 || lower.includes("authentication_invalid") || lower.includes("invalid credential")) {
    return "Invalid API account credentials";
  }
  if (lower.includes("password expired") || lower.includes("passwordexpired")) {
    return "API account password expired";
  }
  if (lower.includes("locked") || lower.includes("account_locked")) {
    return "MICROS API account locked";
  }
  if (lower.includes("orgname") || lower.includes("org not found")) {
    return "Missing or invalid org short name";
  }
  return `Sign-in rejected by Oracle (HTTP ${status})`;
}

function classifyTokenError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (lower.includes("invalid_client")) return "Client ID rejected by Oracle";
  if (lower.includes("invalid_grant"))  return "Authorization code expired or already used";
  if (lower.includes("invalid_request")) return "Invalid PKCE token request parameters";
  return `Token exchange rejected by Oracle (HTTP ${status})`;
}

/** Strips secrets, tokens and long encoded strings from log output. */
function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s"]+/g, "<url>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .replace(/password["']?\s*[:=]\s*["']?[^\s"',}]+/gi, "password=<redacted>")
    .slice(0, 400);
}

/** Shows first 6 chars + last 4, rest masked. */
function mask(value: string): string {
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

async function fetchWithTimeout(
  url:     string,
  init:    RequestInit,
  stage:   string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new MicrosAuthError(
        stage as MicrosAuthError["stage"],
        "PKCE sign-in session failed",
        `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
      );
    }
    throw new MicrosAuthError(
      stage as MicrosAuthError["stage"],
      "PKCE sign-in session failed",
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
