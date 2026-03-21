/**
 * lib/micros/auth.ts
 *
 * Oracle MICROS BIAPI PKCE authentication flow.
 *
 * Implements the exact 4-step flow from the official Oracle docs:
 *   https://docs.oracle.com/en/industries/food-beverage/back-office/20.1/biapi/authenticate.html
 *
 * Step 1: GET  /oidc-provider/v1/oauth2/authorize  (PKCE code_challenge) -> cookies
 * Step 2: POST /oidc-provider/v1/oauth2/signin     (credentials + cookies) -> auth_code
 * Step 3: POST /oidc-provider/v1/oauth2/token       (auth_code + code_verifier) -> id_token
 * Step 4: Use id_token as Bearer token for BI API calls
 *
 * IMPORTANT per Oracle docs:
 *   - Bearer token = id_token (NOT access_token)
 *   - id_token valid for 14 days
 *   - refresh_token valid for 28 days
 *   - redirect_uri is always "apiaccount://callback"
 *   - Password expires after 60 days
 */

import { randomBytes, createHash } from "crypto";
import { getMicrosEnvConfig } from "./config";

// -- Types ------------------------------------------------------------------

export type MicrosAuthMode = "pkce";

export interface OracleTokenSet {
  /** The id_token -- used as Bearer for all API calls (NOT access_token) */
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Unix ms when the id_token expires (14 days from issuance) */
  expiresAt: number;
}

export class MicrosAuthError extends Error {
  constructor(
    public readonly stage:
      | "authorize"
      | "signin"
      | "token"
      | "refresh"
      | "config",
    public readonly userMessage: string,
    public readonly detail?: string,
    public readonly reasonCode?: string
  ) {
    super(
      `[MicrosAuth:${stage}] ${userMessage}${detail ? ` -- ${detail}` : ""}`
    );
    this.name = "MicrosAuthError";
  }
}

// -- Constants --------------------------------------------------------------

const REDIRECT_URI = "apiaccount://callback";
const REQUEST_TIMEOUT_MS = 20_000;

const AUTHORIZE_PATH = "/oidc-provider/v1/oauth2/authorize";
const SIGNIN_PATH = "/oidc-provider/v1/oauth2/signin";
const TOKEN_PATH = "/oidc-provider/v1/oauth2/token";

// -- PKCE Helpers -----------------------------------------------------------

function generateCodeVerifier(): string {
  const bytes = randomBytes(32);
  return bytes.toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// -- Cookie Helpers ---------------------------------------------------------

function parseCookies(headers: Headers): string[] {
  const cookies: string[] = [];

  // Prefer getSetCookie() (Node 18+) which properly handles multiple Set-Cookie headers
  if (typeof headers.getSetCookie === "function") {
    for (const raw of headers.getSetCookie()) {
      const cookiePart = raw.split(";")[0];
      if (cookiePart) cookies.push(cookiePart);
    }
    return cookies;
  }

  // Fallback: iterate headers (works in Node 20 undici but may collapse in some runtimes)
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const cookiePart = value.split(";")[0];
      if (cookiePart) cookies.push(cookiePart);
    }
  });
  return cookies;
}

function cookieHeader(cookies: string[]): string {
  return cookies.join("; ");
}

// -- Token Cache ------------------------------------------------------------

let cachedTokens: OracleTokenSet | null = null;

export function clearMicrosTokenCache(): void {
  cachedTokens = null;
}

export function getMicrosTokenStatus() {
  return {
    valid: !!cachedTokens && cachedTokens.expiresAt > Date.now(),
    expiresAt: cachedTokens?.expiresAt ?? null,
    hasRefreshToken: !!cachedTokens?.refreshToken,
  };
}

export function getAuthMode(): MicrosAuthMode {
  return "pkce";
}

// -- Step 1: Authorize ------------------------------------------------------

async function authorize(
  authServer: string,
  clientId: string,
  codeChallenge: string
): Promise<string[]> {
  const url = new URL(AUTHORIZE_PATH, authServer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = await fetchWithTimeout(url.toString(), {
    method: "GET",
    redirect: "manual",
  });

  if (res.status >= 400) {
    const text = await res.text().catch(() => "");
    throw new MicrosAuthError(
      "authorize",
      "OpenID authorization failed.",
      `HTTP ${res.status}: ${text.slice(0, 300)}`,
      "AUTHORIZE_FAILED"
    );
  }

  const cookies = parseCookies(res.headers);
  if (cookies.length === 0) {
    throw new MicrosAuthError(
      "authorize",
      "No session cookies received from authorize endpoint.",
      undefined,
      "NO_COOKIES"
    );
  }

  return cookies;
}

// -- Step 2: Sign-In --------------------------------------------------------

async function signin(
  authServer: string,
  username: string,
  password: string,
  orgname: string,
  cookies: string[]
): Promise<{ authCode: string; cookies: string[] }> {
  const url = `${authServer}${SIGNIN_PATH}`;

  const body = new URLSearchParams();
  body.set("username", username);
  body.set("password", password);
  body.set("orgname", orgname);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies),
    },
    body: body.toString(),
    redirect: "manual",
  });

  // Collect any new cookies from signin response
  const newCookies = [...cookies, ...parseCookies(res.headers)];

  const text = await res.text();

  if (res.status === 401) {
    let parsed: { message?: string; code?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw new MicrosAuthError(
      "signin",
      "Invalid credentials. Please verify your API account username, password, and org name (Enterprise Short Name). Note: Oracle API passwords expire after 60 days.",
      parsed.code,
      "INVALID_CREDENTIALS"
    );
  }

  if (res.status >= 400) {
    throw new MicrosAuthError(
      "signin",
      `Sign-in failed (HTTP ${res.status}).`,
      text.slice(0, 300),
      "SIGNIN_FAILED"
    );
  }

  // Parse response to extract auth_code from redirectUrl
  let json: {
    nextOp?: string;
    success?: boolean;
    redirectUrl?: string;
    error?: string;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new MicrosAuthError(
      "signin",
      "Unexpected sign-in response format.",
      text.slice(0, 300),
      "SIGNIN_PARSE_ERROR"
    );
  }

  if (
    json.nextOp === "expired" ||
    json.error?.includes("change your password")
  ) {
    throw new MicrosAuthError(
      "signin",
      "API account password has expired. Reset it on the Reporting and Analytics sign-in page.",
      json.error,
      "PASSWORD_EXPIRED"
    );
  }

  if (!json.success || !json.redirectUrl) {
    throw new MicrosAuthError(
      "signin",
      `Sign-in was not successful: ${json.error ?? "unknown error"}`,
      JSON.stringify(json).slice(0, 300),
      "SIGNIN_UNSUCCESSFUL"
    );
  }

  // Extract auth_code from: "apiaccount://callback?code=<auth_code>"
  const codeMatch = json.redirectUrl.match(/[?&]code=([^&]+)/);
  if (!codeMatch?.[1]) {
    throw new MicrosAuthError(
      "signin",
      "No authorization code found in sign-in response.",
      json.redirectUrl.slice(0, 200),
      "NO_AUTH_CODE"
    );
  }

  return { authCode: decodeURIComponent(codeMatch[1]), cookies: newCookies };
}

// -- Step 3: Get Token ------------------------------------------------------

async function getToken(
  authServer: string,
  clientId: string,
  codeVerifier: string,
  authCode: string,
  cookies: string[]
): Promise<OracleTokenSet> {
  const url = `${authServer}${TOKEN_PATH}`;

  const body = new URLSearchParams();
  body.set("scope", "openid");
  body.set("grant_type", "authorization_code");
  body.set("client_id", clientId);
  body.set("code_verifier", codeVerifier);
  body.set("code", authCode);
  body.set("redirect_uri", REDIRECT_URI);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(cookies),
    },
    body: body.toString(),
    redirect: "manual",
  });

  const text = await res.text();

  if (!res.ok) {
    let parsed: { message?: string; code?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw new MicrosAuthError(
      "token",
      `Token request failed (HTTP ${res.status}): ${parsed.message ?? text.slice(0, 200)}`,
      parsed.code,
      "TOKEN_FAILED"
    );
  }

  let json: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: string | number;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new MicrosAuthError(
      "token",
      "Invalid token response format.",
      text.slice(0, 300)
    );
  }

  if (!json.id_token) {
    throw new MicrosAuthError(
      "token",
      "No id_token in token response.",
      text.slice(0, 300)
    );
  }

  const expiresInSec = parseInt(String(json.expires_in ?? "1209600"), 10);

  return {
    idToken: json.id_token,
    accessToken: json.access_token ?? "",
    refreshToken: json.refresh_token ?? "",
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

// -- Refresh Token ----------------------------------------------------------

async function refreshTokens(
  authServer: string,
  clientId: string,
  refreshToken: string
): Promise<OracleTokenSet> {
  const url = `${authServer}${TOKEN_PATH}`;

  const body = new URLSearchParams();
  body.set("scope", "openid");
  body.set("grant_type", "refresh_token");
  body.set("client_id", clientId);
  body.set("refresh_token", refreshToken);
  body.set("redirect_uri", REDIRECT_URI);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();

  if (!res.ok) {
    let parsed: { message?: string; code?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw new MicrosAuthError(
      "refresh",
      `Token refresh failed (HTTP ${res.status}): ${parsed.message ?? text.slice(0, 200)}`,
      parsed.code,
      "REFRESH_FAILED"
    );
  }

  let json: {
    access_token?: string;
    id_token?: string;
    refresh_token?: string;
    expires_in?: string | number;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new MicrosAuthError(
      "refresh",
      "Invalid refresh response format."
    );
  }

  if (!json.id_token) {
    throw new MicrosAuthError(
      "refresh",
      "No id_token in refresh response."
    );
  }

  const expiresInSec = parseInt(String(json.expires_in ?? "1209600"), 10);

  return {
    idToken: json.id_token,
    accessToken: json.access_token ?? "",
    refreshToken: json.refresh_token ?? cachedTokens?.refreshToken ?? "",
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}

// -- Full Auth Flow ---------------------------------------------------------

/**
 * Orchestrates the full PKCE auth flow:
 *   authorize -> signin -> token
 *
 * Returns the id_token to use as Bearer.
 */
async function doFullAuth(): Promise<OracleTokenSet> {
  const cfg = getMicrosEnvConfig();

  if (!cfg.authServer || !cfg.clientId || !cfg.apiAccountName) {
    throw new MicrosAuthError(
      "config",
      "MICROS BIAPI is not fully configured.",
      undefined,
      "MISSING_CONFIG"
    );
  }

  const password = (
    process.env.MICROS_PASSWORD ??
    process.env.MICROS_API_ACCOUNT_PASSWORD ??
    ""
  ).trim();
  if (!password) {
    throw new MicrosAuthError(
      "config",
      "MICROS_PASSWORD is not set.",
      undefined,
      "NO_PASSWORD"
    );
  }

  // Step 1: Generate PKCE pair
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Step 2: Authorize (get cookies)
  const authCookies = await authorize(
    cfg.authServer,
    cfg.clientId,
    codeChallenge
  );

  // Step 3: Sign in (get auth_code)
  const { authCode, cookies } = await signin(
    cfg.authServer,
    cfg.apiAccountName,
    password,
    cfg.orgIdentifier, // Enterprise Short Name = orgname
    authCookies
  );

  // Step 4: Exchange auth_code for tokens
  const tokens = await getToken(
    cfg.authServer,
    cfg.clientId,
    codeVerifier,
    authCode,
    cookies
  );

  cachedTokens = tokens;
  return tokens;
}

// -- Public API -------------------------------------------------------------

/**
 * Returns a valid id_token for use as Bearer in BIAPI calls.
 *
 * Uses cached token if valid, refreshes if possible, or does full auth.
 * Per Oracle docs: use id_token (NOT access_token) for Bearer auth.
 */
export async function getMicrosIdToken(): Promise<string> {
  // Check cached token -- refresh 3 days before expiry
  const REFRESH_BUFFER_MS = 3 * 24 * 60 * 60 * 1000;

  if (cachedTokens) {
    if (cachedTokens.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
      return cachedTokens.idToken;
    }

    // Try refresh
    if (cachedTokens.refreshToken) {
      try {
        const cfg = getMicrosEnvConfig();
        cachedTokens = await refreshTokens(
          cfg.authServer,
          cfg.clientId,
          cachedTokens.refreshToken
        );
        return cachedTokens.idToken;
      } catch {
        // Refresh failed -- fall through to full auth
        cachedTokens = null;
      }
    }
  }

  const tokens = await doFullAuth();
  return tokens.idToken;
}

/** @deprecated Alias kept for backward compatibility */
export async function getMicrosAccessToken(): Promise<string> {
  return getMicrosIdToken();
}

// -- Timeout helper ---------------------------------------------------------

function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}
