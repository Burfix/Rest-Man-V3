/**
 * lib/micros/location-auth.ts
 *
 * Per-location token acquisition for Oracle MICROS BIAPI.
 *
 * Supports two auth flows:
 *   pkce               — Si Cantina: 4-step PKCE (authorize → signin → token)
 *   client_credentials — Primi Camps Bay: OAuth2 client credentials grant
 *
 * SECURITY:
 *   - Credentials are read from LocationConfig, which reads from server-side env vars only.
 *   - Tokens are cached in a per-location Map (server-side memory only).
 *   - Tokens are never logged or returned to callers.
 *   - clientSecret and password are never logged.
 *
 * IMPORTANT: This module is SERVER-ONLY. Never import in client components.
 */

import { randomBytes, createHash } from "crypto";
import type { LocationConfig, LocationKey } from "./micros-location-registry";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocationTokenSet {
  /** Bearer token to use for BIAPI calls. */
  bearerToken: string;
  /** Unix ms when the token expires. */
  expiresAt: number;
}

export class LocationAuthError extends Error {
  constructor(
    public readonly locationKey: string,
    public readonly stage: "config" | "authorize" | "signin" | "token" | "client_credentials",
    public readonly userMessage: string,
    public readonly detail?: string,
  ) {
    super(`[LocationAuth:${locationKey}:${stage}] ${userMessage}${detail ? ` — ${detail}` : ""}`);
    this.name = "LocationAuthError";
  }
}

// ── Token cache (per-location, server-side memory only) ────────────────────

const tokenCache = new Map<LocationKey, LocationTokenSet>();

/** Returns the cached token for a location, or null if absent / expired. */
export function getCachedLocationToken(key: LocationKey): LocationTokenSet | null {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  // 60 s buffer so we never pass an about-to-expire token to the BIAPI
  if (entry.expiresAt <= Date.now() + 60_000) {
    tokenCache.delete(key);
    return null;
  }
  return entry;
}

/** Clears the in-memory token for a specific location (e.g. after a 401). */
export function clearLocationTokenCache(key: LocationKey): void {
  tokenCache.delete(key);
}

/** Seeds the cache directly — useful for persisting across serverless cold-starts. */
export function seedLocationTokenCache(key: LocationKey, token: LocationTokenSet): void {
  tokenCache.set(key, token);
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Acquires a valid Bearer token for the given location, using the cache
 * when available. Dispatches to the correct auth flow based on cfg.authFlow.
 *
 * Never returns the raw token value from its callers —
 * callers should pass it directly to `buildLocationClient` or BIAPI fetch.
 */
export async function acquireLocationToken(cfg: LocationConfig): Promise<string> {
  if (!cfg.configured) {
    throw new LocationAuthError(
      cfg.key,
      "config",
      `Location "${cfg.displayName}" is not fully configured.`,
    );
  }
  if (!cfg.enabled) {
    throw new LocationAuthError(
      cfg.key,
      "config",
      `Location "${cfg.displayName}" integration is disabled.`,
    );
  }

  // Check cache first
  const cached = getCachedLocationToken(cfg.key);
  if (cached) return cached.bearerToken;

  // Acquire a fresh token
  const tokenSet = cfg.authFlow === "client_credentials"
    ? await acquireClientCredentialsToken(cfg)
    : await acquirePkceToken(cfg);

  tokenCache.set(cfg.key, tokenSet);
  return tokenSet.bearerToken;
}

// ── PKCE flow (Si Cantina) ─────────────────────────────────────────────────

const PKCE_REDIRECT_URI    = "apiaccount://callback";
const PKCE_TIMEOUT_MS      = 30_000;
const PKCE_AUTHORIZE_PATH  = "/oidc-provider/v1/oauth2/authorize";
const PKCE_SIGNIN_PATH     = "/oidc-provider/v1/oauth2/signin";
const PKCE_TOKEN_PATH      = "/oidc-provider/v1/oauth2/token";
const USER_AGENT           = "ForgeStackOps/1.0";

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PKCE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseCookieHeaders(headers: Headers): string[] {
  const cookies: string[] = [];
  if (typeof headers.getSetCookie === "function") {
    for (const raw of headers.getSetCookie()) {
      const part = raw.split(";")[0];
      if (part) cookies.push(part);
    }
    return cookies;
  }
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const part = value.split(";")[0];
      if (part) cookies.push(part);
    }
  });
  return cookies;
}

async function pkceAuthorize(cfg: LocationConfig, codeChallenge: string): Promise<string[]> {
  const url = new URL(PKCE_AUTHORIZE_PATH, cfg.authUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("redirect_uri", PKCE_REDIRECT_URI);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = await fetchWithTimeout(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    cache: "no-store",
  });

  if (res.status >= 400) {
    const text = await res.text().catch(() => "");
    throw new LocationAuthError(
      cfg.key, "authorize", "OpenID authorization failed.",
      `HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  const cookies = parseCookieHeaders(res.headers);
  if (cookies.length === 0) {
    throw new LocationAuthError(cfg.key, "authorize", "No session cookies from authorize endpoint.");
  }
  return cookies;
}

async function pkceSignin(
  cfg: LocationConfig,
  cookies: string[],
): Promise<{ authCode: string; cookies: string[] }> {
  const body = new URLSearchParams();
  // password is read from env via LocationConfig — never logged
  body.set("username", cfg.username ?? "");
  body.set("password", cfg.password ?? "");
  body.set("orgname", cfg.enterpriseShortName);

  const res = await fetchWithTimeout(`${cfg.authUrl}${PKCE_SIGNIN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Cookie: cookies.join("; "),
    },
    body: body.toString(),
    redirect: "manual",
    cache: "no-store",
  });

  const newCookies = [...cookies, ...parseCookieHeaders(res.headers)];
  const text = await res.text();

  if (res.status === 401) {
    throw new LocationAuthError(
      cfg.key, "signin",
      "Invalid credentials. Check username, password, and enterprise short name. Oracle passwords expire after 60 days.",
    );
  }
  if (res.status >= 400) {
    throw new LocationAuthError(cfg.key, "signin", `Sign-in failed (HTTP ${res.status}).`, text.slice(0, 200));
  }

  let json: { nextOp?: string; success?: boolean; redirectUrl?: string; error?: string };
  try { json = JSON.parse(text); }
  catch { throw new LocationAuthError(cfg.key, "signin", "Unexpected sign-in response format.", text.slice(0, 200)); }

  if (json.nextOp === "expired" || json.error?.includes("change your password")) {
    throw new LocationAuthError(cfg.key, "signin", "API account password has expired. Reset it in Oracle IDM.", json.error);
  }
  if (!json.success || !json.redirectUrl) {
    throw new LocationAuthError(cfg.key, "signin", `Sign-in unsuccessful: ${json.error ?? "unknown error"}`);
  }

  const codeMatch = json.redirectUrl.match(/[?&]code=([^&]+)/);
  if (!codeMatch?.[1]) {
    throw new LocationAuthError(cfg.key, "signin", "No authorization code in sign-in response.", json.redirectUrl.slice(0, 200));
  }

  return { authCode: decodeURIComponent(codeMatch[1]), cookies: newCookies };
}

async function pkceExchangeToken(
  cfg: LocationConfig,
  authCode: string,
  codeVerifier: string,
  cookies: string[],
): Promise<LocationTokenSet> {
  const body = new URLSearchParams();
  body.set("scope", "openid");
  body.set("grant_type", "authorization_code");
  body.set("client_id", cfg.clientId);
  body.set("code_verifier", codeVerifier);
  body.set("code", authCode);
  body.set("redirect_uri", PKCE_REDIRECT_URI);

  const res = await fetchWithTimeout(`${cfg.authUrl}${PKCE_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Cookie: cookies.join("; "),
    },
    body: body.toString(),
    redirect: "manual",
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new LocationAuthError(cfg.key, "token", `Token request failed (HTTP ${res.status}).`, text.slice(0, 200));
  }

  let json: { id_token?: string; access_token?: string; expires_in?: string | number };
  try { json = JSON.parse(text); }
  catch { throw new LocationAuthError(cfg.key, "token", "Invalid token response format.", text.slice(0, 200)); }

  if (!json.id_token) {
    throw new LocationAuthError(cfg.key, "token", "No id_token in token response.", text.slice(0, 200));
  }

  const expiresInSec = parseInt(String(json.expires_in ?? "1209600"), 10);
  return {
    bearerToken: json.id_token,   // PKCE flow uses id_token as Bearer
    expiresAt: Date.now() + expiresInSec * 1_000,
  };
}

async function acquirePkceToken(cfg: LocationConfig): Promise<LocationTokenSet> {
  const codeVerifier  = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authCookies = await pkceAuthorize(cfg, codeChallenge);
  const { authCode, cookies } = await pkceSignin(cfg, authCookies);
  return pkceExchangeToken(cfg, authCode, codeVerifier, cookies);
}

// ── Client credentials flow (Primi Camps Bay) ─────────────────────────────

const CC_TOKEN_PATH    = "/oidc-provider/v1/oauth2/token";
const CC_TIMEOUT_MS    = 30_000;

async function acquireClientCredentialsToken(cfg: LocationConfig): Promise<LocationTokenSet> {
  if (!cfg.clientSecret) {
    throw new LocationAuthError(
      cfg.key, "client_credentials",
      "Client credentials flow requires a clientSecret (MICROS_PRIMI_CAMPS_BAY_CLIENT_SECRET not set).",
    );
  }

  const url = `${cfg.authUrl}${CC_TOKEN_PATH}`;

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", "openid");

  // Use HTTP Basic auth: Authorization: Basic base64(clientId:clientSecret)
  // clientSecret is read from env var, never logged
  const credentials = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CC_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    throw new LocationAuthError(
      cfg.key, "client_credentials",
      `Token request failed (HTTP ${res.status}).`,
      // Strip any token-looking content from error body
      text.replace(/"(access_token|id_token|refresh_token)"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"').slice(0, 300),
    );
  }

  let json: { access_token?: string; id_token?: string; expires_in?: string | number };
  try { json = JSON.parse(text); }
  catch {
    throw new LocationAuthError(cfg.key, "client_credentials", "Invalid token response format.", text.slice(0, 200));
  }

  // Client credentials returns access_token; fall back to id_token if present
  const bearerToken = json.access_token ?? json.id_token;
  if (!bearerToken) {
    throw new LocationAuthError(
      cfg.key, "client_credentials",
      "No access_token in client credentials response.",
    );
  }

  const expiresInSec = parseInt(String(json.expires_in ?? "3600"), 10);
  return {
    bearerToken,
    expiresAt: Date.now() + expiresInSec * 1_000,
  };
}
