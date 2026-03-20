/**
 * services/micros/MicrosAuthService.ts
 *
 * Oracle MICROS BI API — OpenID Connect token service.
 *
 * Auth flow (Oracle BIAPI — Resource Owner Password Credentials):
 *   Token endpoint: POST /oidc-provider/v1/oauth2/token
 *   grant_type=password with:
 *     username      = MICROS_API_ACCOUNT_NAME  (BIAPI account — NOT a standard RNA user)
 *     password      = MICROS_API_ACCOUNT_PASSWORD
 *     client_id     = MICROS_CLIENT_ID
 *     client_secret = MICROS_CLIENT_SECRET  (if set — required by most Oracle MSAF tenants)
 *   Client auth method: client_secret_post — credentials go in the POST body.
 *
 *   On token expiry: re-issue via refresh_token grant if the server returned one,
 *   otherwise re-authenticate with the password grant.
 *
 * Security rules:
 *  - MICROS_API_ACCOUNT_PASSWORD and MICROS_CLIENT_SECRET are read from env only.
 *    NEVER logged, NEVER included in error messages, NEVER sent to the client.
 *  - access_token and refresh_token are kept in process memory only.
 *  - All diagnostic logs use sanitize() to strip tokens, URLs, and long strings.
 *
 * Structured log events emitted (all server-side only):
 *   [MicrosAuth:config] Startup validation summary
 *   [MicrosAuth] Pre-request diagnostics for every token attempt
 *   [MicrosAuth] Token obtained via password grant. Expires in N min.
 *   [MicrosAuth] Token refreshed via refresh_token grant. Expires in N min.
 *   [MicrosAuth] token acquisition attempt N/2 failed: <sanitized message>
 *   [MicrosAuth] Authentication failed after 2 attempts. Last error: ...
 *
 * Env vars consumed (all server-side only):
 *   MICROS_AUTH_SERVER           Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_CLIENT_ID             Registered OIDC client ID
 *   MICROS_CLIENT_SECRET         Client secret (used in POST body for ROPC grant)
 *   MICROS_API_ACCOUNT_NAME      BIAPI account username
 *   MICROS_API_ACCOUNT_PASSWORD  BIAPI account password
 *   MICROS_ORG_IDENTIFIER        Oracle org/tenant identifier
 *   MICROS_LOC_REF               Location reference for the pilot store
 *   MICROS_AUTH_SCOPE            OAuth scope (optional; default: "openid")
 *   MICROS_AUTH_TOKEN_PATH       Token endpoint path override
 *                                (default: /oidc-provider/v1/oauth2/token)
 */

import { assertMicrosConfigured, getMicrosEnvConfig } from "@/lib/micros/config";
import type { _OracleTokenResponse }                  from "@/types/micros";

// ── Constants ─────────────────────────────────────────────────────────────

/** Default Oracle MSAF OIDC token endpoint path. */
const DEFAULT_TOKEN_PATH = "/oidc-provider/v1/oauth2/token";

/** Refresh access token 5 minutes before it actually expires. */
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/** Per-call timeout for token endpoint requests. */
const AUTH_TIMEOUT_MS = 15_000;

// ── In-memory token state ─────────────────────────────────────────────────

interface TokenState {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    number; // unix ms
}

// ── Service ───────────────────────────────────────────────────────────────

class MicrosAuthServiceImpl {
  private state:           TokenState | null      = null;
  private inflightRequest: Promise<string> | null = null;

  /**
   * Returns a valid Bearer access token.
   *
   * Uses cached token if still valid; uses refresh_token grant if the access
   * token has expired; falls back to client_credentials grant when both are
   * exhausted or unavailable.
   *
   * Concurrent callers share a single inflight request — no thundering herd.
   */
  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.state!.accessToken;
    }

    if (this.inflightRequest) {
      return this.inflightRequest;
    }

    this.inflightRequest = this.acquireToken();
    try {
      return await this.inflightRequest;
    } finally {
      this.inflightRequest = null;
    }
  }

  /**
   * Forces re-acquisition of the access token.
   *
   * Preserves the stored refresh_token so acquireToken() will attempt the
   * cheaper refresh grant before falling back to client_credentials.
   * Called by MicrosApiClient on HTTP 401 responses.
   */
  async refreshAccessToken(): Promise<string> {
    // Preserve refresh_token so acquireToken() can try it before client_credentials.
    const savedRefreshToken = this.state?.refreshToken ?? null;
    this.state = savedRefreshToken
      ? { accessToken: "", refreshToken: savedRefreshToken, expiresAt: 0 }
      : null;
    return this.getAccessToken();
  }

  /** Returns true when the cached access token is valid and not near expiry. */
  isTokenValid(): boolean {
    return (
      this.state !== null &&
      this.state.accessToken.length > 0 &&
      this.state.expiresAt - Date.now() > TOKEN_BUFFER_MS
    );
  }

  /** Clears all cached tokens (access + refresh). Use before a fresh test. */
  clearCache(): void {
    this.state = null;
  }

  /**
   * Returns the current token status — safe to surface in settings UI.
   * Never includes the token value itself.
   */
  getTokenStatus(): {
    valid:          boolean;
    expiresAt:      number | null;
    hasRefreshToken: boolean;
  } {
    return {
      valid:           this.isTokenValid(),
      expiresAt:       this.state?.expiresAt ?? null,
      hasRefreshToken: !!this.state?.refreshToken,
    };
  }

  // ── Token acquisition ────────────────────────────────────────────────────

  private async acquireToken(): Promise<string> {
    // ── Path A: refresh_token grant (preferred — no password re-transmission) ──
    if (this.state?.refreshToken) {
      try {
        const data = await this.executeRefreshGrant(this.state.refreshToken);
        this.state = {
          accessToken:  data.access_token,
          refreshToken: data.refresh_token ?? this.state.refreshToken,
          expiresAt:    Date.now() + data.expires_in * 1000,
        };
        console.info(
          `[MicrosAuth] Token refreshed via refresh_token grant. ` +
          `Expires in ${Math.round(data.expires_in / 60)} min.`,
        );
        return this.state.accessToken;
      } catch (err) {
        const safe = sanitize(err instanceof Error ? err.message : String(err));
        console.warn(`[MicrosAuth] refresh failure — ${safe}. Re-acquiring with password grant.`);
        this.state = null;
      }
    }

    // ── Path B: password grant (BIAPI account credentials) ────────────────────
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await this.executePasswordGrant();
        this.state = {
          accessToken:  data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresAt:    Date.now() + data.expires_in * 1000,
        };
        console.info(
          `[MicrosAuth] Token obtained via password grant. ` +
          `Expires in ${Math.round(data.expires_in / 60)} min.` +
          (this.state.refreshToken ? " Refresh token stored." : ""),
        );
        return this.state.accessToken;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const safe = sanitize(lastError.message);
        console.error(`[MicrosAuth] token acquisition attempt ${attempt + 1}/2 failed: ${safe}`);
        if (attempt === 0) {
          await delay(1_000);
        }
      }
    }

    throw new Error(
      `[MicrosAuth] Authentication failed after 2 attempts. ` +      (lastError ? `Last error: ${sanitize(lastError.message)}. ` : "") +      `Verify MICROS_AUTH_SERVER, MICROS_CLIENT_ID, MICROS_API_ACCOUNT_NAME, ` +
      `and MICROS_API_ACCOUNT_PASSWORD are correct and that the BIAPI account ` +
      `is registered in Oracle IDM with the required API access grant.`,
    );
  }

  // ── Grant implementations ────────────────────────────────────────────────

  /**
   * OAuth 2.0 Resource Owner Password Credentials grant (BIAPI path).
   *
   * Oracle BIAPI requires a dedicated API account — do NOT use a standard
   * RNA / OIDC user. The grant uses the BIAPI account username + password,
   * plus client_id and (if set) client_secret in the POST body.
   *
   * Most Oracle MSAF tenants require client_secret even for ROPC — always
   * include it when MICROS_CLIENT_SECRET is configured.
   *
   * @throws if MICROS_API_ACCOUNT_PASSWORD is not set
   * @internal
   */
  private async executePasswordGrant(): Promise<_OracleTokenResponse> {
    const cfg = assertMicrosConfigured();

    if (!cfg.apiAccountPassword) {
      throw new Error(
        "MICROS BIAPI password missing — set MICROS_API_ACCOUNT_PASSWORD " +
        "in your environment variables (Vercel project settings → Environment Variables).",
      );
    }
    if (!cfg.apiAccountName) {
      throw new Error(
        "MICROS BIAPI username missing — set MICROS_API_ACCOUNT_NAME " +
        "in your environment variables.",
      );
    }
    if (!cfg.clientId) {
      throw new Error(
        "MICROS client ID missing — set MICROS_CLIENT_ID in your environment variables.",
      );
    }

    const body: Record<string, string> = {
      grant_type: "password",
      username:   cfg.apiAccountName,
      password:   cfg.apiAccountPassword,
      scope:      process.env.MICROS_AUTH_SCOPE?.trim() || "openid",
    };

    // Include client_secret when configured — Oracle MSAF tenants typically
    // require it in the POST body (client_secret_post method) even for ROPC.
    return this.postTokenEndpoint(body, cfg.clientId, cfg.clientSecret, cfg.authServer, "password-grant");
  }

  /**
   * OAuth 2.0 Client Credentials grant.
   *
   * Kept for compatibility; not used by default now that the BIAPI password
   * grant is the primary auth path. Only called if explicitly invoked.
   *
   * @internal
   */
  private async executeClientCredentialsGrant(): Promise<_OracleTokenResponse> {
    const cfg = assertMicrosConfigured();

    if (!cfg.clientSecret) {
      throw new Error(
        "MICROS credentials incomplete — client secret required. " +
        "Set MICROS_CLIENT_SECRET in your environment variables " +
        "(Vercel project settings → Environment Variables).",
      );
    }

    const body: Record<string, string> = {
      grant_type: "client_credentials",
      scope:      process.env.MICROS_AUTH_SCOPE?.trim() || "openid",
    };

    return this.postTokenEndpoint(body, cfg.clientId, cfg.clientSecret, cfg.authServer, "client-credentials");
  }

  /**
   * Refresh token grant.
   *
   * Exchanges a stored refresh_token for a fresh access_token without
   * performing a full client_credentials re-authentication.
   *
   * @internal
   */
  private async executeRefreshGrant(refreshToken: string): Promise<_OracleTokenResponse> {
    const cfg = getMicrosEnvConfig();

    const body: Record<string, string> = {
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    };

    return this.postTokenEndpoint(body, cfg.clientId, cfg.clientSecret, cfg.authServer, "token-refresh");
  }

  // ── Core HTTP helper ─────────────────────────────────────────────────────

  /**
   * HTTP POST to the Oracle OIDC token endpoint.
   *
   * Client auth method: client_secret_post — client_id + client_secret go in
   * the POST body (Oracle MSAF OIDC standard). No Authorization: Basic header.
   *
   * `x-requested-by: Oracle` is required by Oracle IDM to bypass CSRF
   * protection for API (non-browser) clients.
   *
   * @internal
   */
  private async postTokenEndpoint(
    bodyParams:   Record<string, string>,
    clientId:     string,
    clientSecret: string,
    authServer:   string,
    grantLabel:   string,
  ): Promise<_OracleTokenResponse> {
    const tokenPath = process.env.MICROS_AUTH_TOKEN_PATH?.trim() || DEFAULT_TOKEN_PATH;
    const tokenUrl  = `${authServer}${tokenPath}`;

    // ── Startup validation: catch misconfigured token path ───────────────
    if (
      tokenPath !== DEFAULT_TOKEN_PATH &&
      tokenPath.includes("/oauth2/v1/token") &&
      !tokenPath.includes("/oidc-provider/")
    ) {
      console.error(
        `[MicrosAuth] MISCONFIGURATION: MICROS_AUTH_TOKEN_PATH is set to the legacy Oracle path.\n` +
        `  Current : ${tokenPath}\n` +
        `  Required: ${DEFAULT_TOKEN_PATH}\n` +
        `  Fix: remove MICROS_AUTH_TOKEN_PATH from env vars.`,
      );
      throw new Error(
        `[MicrosAuth] Wrong token endpoint configured. MICROS_AUTH_TOKEN_PATH='${tokenPath}' ` +
        `is the legacy Oracle path. Remove this env var or set it to '${DEFAULT_TOKEN_PATH}'.`,
      );
    }

    // ── Build POST body ───────────────────────────────────────────────────
    const params: Record<string, string> = { ...bodyParams };
    params.client_id = clientId;
    if (clientSecret) {
      params.client_secret = clientSecret;
    }

    // ── Pre-request diagnostics (no credential values) ───────────────────
    console.log(
      `[MicrosAuth] Pre-request diagnostics:\n` +
      `  grant:          ${grantLabel}\n` +
      `  tokenUrl:       ${tokenUrl}\n` +
      `  authServer:     ${authServer || "(empty — MICROS_AUTH_SERVER not set)"}\n` +
      `  tokenPath:      ${tokenPath}\n` +
      `  client_id:      ${clientId ? `${clientId.slice(0, 8)}… (${clientId.length} chars)` : "(empty — MICROS_CLIENT_ID not set)"}\n` +
      `  client_secret:  ${clientSecret ? `set (${clientSecret.length} chars)` : "not set"}\n` +
      `  client auth:    client_secret_post (credentials in POST body)\n` +
      `  username:       ${params.username ? `${params.username.slice(0, 6)}… (${params.username.length} chars)` : "n/a"}\n` +
      `  password:       ${params.password ? `set (${params.password.length} chars)` : "n/a"}\n` +
      `  scope:          ${params.scope ?? "not set"}\n` +
      `  grant_type:     ${params.grant_type}`,
    );

    const headers: Record<string, string> = {
      "Content-Type":   "application/x-www-form-urlencoded",
      "x-requested-by": "Oracle",
    };

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method:  "POST",
        headers,
        body:    new URLSearchParams(params).toString(),
        signal:  controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError"
        ? `request timed out after ${AUTH_TIMEOUT_MS}ms`
        : `connection failed — is MICROS_AUTH_SERVER reachable from this server?`;
      throw new Error(`[MicrosAuth] Network error during ${grantLabel}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const msg = await buildHttpError(res, tokenUrl, grantLabel);
      throw new Error(msg);
    }

    const json = (await res.json()) as _OracleTokenResponse;

    if (!json.access_token) {
      throw new Error(`[MicrosAuth] ${grantLabel} response missing access_token.`);
    }
    if (typeof json.expires_in !== "number" || json.expires_in <= 0) {
      throw new Error(`[MicrosAuth] ${grantLabel} response has invalid expires_in (got: ${json.expires_in}).`);
    }

    return json;
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Builds an admin-safe, actionable error from an HTTP failure response.
 *
 * Captures raw response body for all status codes so no information is lost —
 * Oracle returns both JSON {error, error_description} and plain-text / HTML.
 */
async function buildHttpError(
  res:        Response,
  url:        string,
  grantLabel: string,
): Promise<string> {
  // Always capture the raw body — Oracle returns JSON for 400/401 but
  // text/html for 404/405 and some 500s.
  let rawBody = "";
  try {
    rawBody = await res.text();
  } catch {
    rawBody = "(could not read response body)";
  }

  // Extract Oracle's structured error fields from JSON when possible.
  let oracleCode = "";
  let oracleDesc = "";
  try {
    const parsed = JSON.parse(rawBody) as { error?: string; error_description?: string };
    if (parsed.error)             oracleCode = ` [${parsed.error}]`;
    if (parsed.error_description) oracleDesc = `: ${parsed.error_description}`;
  } catch {
    // Not JSON — include a sanitized excerpt of the raw body instead.
  }

  // Safe excerpt: strip tags, long tokens, clip to 300 chars.
  const bodyExcerpt = rawBody
    .replace(/<[^>]+>/g, " ")              // strip HTML tags
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<token>") // redact long encoded strings
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

  console.error(
    `[MicrosAuth] ${grantLabel} failed.\n` +
    `  URL:    ${url}\n` +
    `  Status: ${res.status} ${res.statusText}\n` +
    `  Body:   ${bodyExcerpt || "(empty)"}`,
  );

  switch (res.status) {
    case 400:
      return (
        `[MicrosAuth] Token request rejected (HTTP 400${oracleCode})${oracleDesc}. ` +
        `Invalid request parameters — check MICROS_CLIENT_ID, MICROS_API_ACCOUNT_NAME, ` +
        `and MICROS_ORG_IDENTIFIER. Body excerpt: ${bodyExcerpt.slice(0, 150)}`
      );
    case 401:
      return (
        `[MicrosAuth] Auth rejected by Oracle (HTTP 401${oracleCode})${oracleDesc}. ` +
        `BIAPI credentials rejected — verify MICROS_CLIENT_ID, MICROS_CLIENT_SECRET, ` +
        `MICROS_API_ACCOUNT_NAME, and MICROS_API_ACCOUNT_PASSWORD are correct.`
      );
    case 403:
      return (
        `[MicrosAuth] Access denied (HTTP 403). ` +
        `The BIAPI account may lack the required API access grant in Oracle IDM.`
      );
    case 404:
      return (
        `[MicrosAuth] Token endpoint not found (HTTP 404) at ${url}. ` +
        `Check MICROS_AUTH_SERVER (no trailing slash) and MICROS_AUTH_TOKEN_PATH ` +
        `(default: ${DEFAULT_TOKEN_PATH}).`
      );
    case 405:
      return (
        `[MicrosAuth] POST rejected by Oracle (HTTP 405) at ${url}. ` +
        `This usually means MICROS_AUTH_SERVER contains the full token path — ` +
        `it should be the base URL only (e.g. https://host.example.com). ` +
        `Current MICROS_AUTH_TOKEN_PATH: ${process.env.MICROS_AUTH_TOKEN_PATH ?? "(default)"}.`
      );
    default:
      return (
        `[MicrosAuth] ${grantLabel} failed (HTTP ${res.status} ${res.statusText}). ` +
        `Body: ${bodyExcerpt.slice(0, 200)}`
      );
  }
}

/** Strips long base64/hex strings and full URLs that might encode secrets. */
function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .slice(0, 300);
}

// ── Startup config validation ─────────────────────────────────────────────

/**
 * Logs a one-time startup summary of the MICROS auth configuration.
 * Safe to call on any server boot — never logs credential values.
 */
function logStartupConfig(): void {
  const vars: Record<string, string | undefined> = {
    MICROS_ENABLED:              process.env.MICROS_ENABLED,
    MICROS_AUTH_SERVER:          process.env.MICROS_AUTH_SERVER,
    MICROS_APP_SERVER:           process.env.MICROS_APP_SERVER,
    MICROS_CLIENT_ID:            process.env.MICROS_CLIENT_ID,
    MICROS_CLIENT_SECRET:        process.env.MICROS_CLIENT_SECRET,
    MICROS_API_ACCOUNT_NAME:     process.env.MICROS_API_ACCOUNT_NAME,
    MICROS_API_ACCOUNT_PASSWORD: process.env.MICROS_API_ACCOUNT_PASSWORD,
    MICROS_ORG_IDENTIFIER:       process.env.MICROS_ORG_IDENTIFIER,
    MICROS_LOC_REF:              process.env.MICROS_LOC_REF,
    MICROS_AUTH_TOKEN_PATH:      process.env.MICROS_AUTH_TOKEN_PATH,
    MICROS_AUTH_SCOPE:           process.env.MICROS_AUTH_SCOPE,
  };

  const lines = Object.entries(vars).map(([k, v]) => {
    if (v === undefined || v === "") return `  ${k}: NOT SET`;
    // Show a short non-sensitive preview for URL vars, hide credential values.
    if (k.endsWith("_PASSWORD") || k.endsWith("_SECRET")) return `  ${k}: set (${v.length} chars)`;
    if (k.endsWith("_SERVER") || k.endsWith("_APP_SERVER")) return `  ${k}: ${v}`;
    return `  ${k}: ${v}`;
  });

  const tokenPath = process.env.MICROS_AUTH_TOKEN_PATH?.trim() || DEFAULT_TOKEN_PATH;
  const authServer = (process.env.MICROS_AUTH_SERVER ?? "").replace(/\/$/, "");
  const resolvedTokenUrl = authServer ? `${authServer}${tokenPath}` : "(cannot resolve — MICROS_AUTH_SERVER not set)";

  console.log(
    `[MicrosAuth:config] Startup validation:\n` +
    lines.join("\n") + "\n" +
    `  → resolved token URL: ${resolvedTokenUrl}`,
  );

  // Warn on known misconfigurations.
  if (authServer.includes("/oidc-provider") || authServer.includes("/oauth2")) {
    console.warn(
      `[MicrosAuth:config] WARNING: MICROS_AUTH_SERVER appears to contain a path. ` +
      `It should be the base URL only (e.g. https://host.example.com). ` +
      `Current value: ${authServer}`,
    );
  }
  if (tokenPath !== DEFAULT_TOKEN_PATH) {
    console.warn(
      `[MicrosAuth:config] WARNING: MICROS_AUTH_TOKEN_PATH is overridden to '${tokenPath}'. ` +
      `The correct Oracle MSAF default is '${DEFAULT_TOKEN_PATH}'.`,
    );
  }
}

// ── Module singleton ──────────────────────────────────────────────────────
// One instance per Node.js process — ensures the token cache is shared across
// all server-side callers, including concurrent requests.

export const MicrosAuthService = new MicrosAuthServiceImpl();

// Log startup config once when this module is first imported.
logStartupConfig();
