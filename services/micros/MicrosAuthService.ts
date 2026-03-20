/**
 * services/micros/MicrosAuthService.ts
 *
 * Oracle MICROS BI API — OpenID Connect token service.
 *
 * Auth flow (Oracle MSAF OIDC — Client Credentials):
 *   Token endpoint: POST /oidc-provider/v1/oauth2/token
 *   grant_type=client_credentials (the only machine-level grant the Oracle
 *   MSAF OIDC server advertises via /.well-known/openid-configuration).
 *   Auth method: client_secret_post — client_id and client_secret go in
 *   the POST body, NOT in an Authorization: Basic header.
 *
 *   On token expiry: re-issue via client_credentials (or use refresh_token
 *   grant if the server returned one).
 *
 * Security rules:
 *  - MICROS_CLIENT_SECRET is read from env — NEVER logged or exposed.
 *  - access_token and refresh_token are kept in process memory only.
 *    They are NEVER written to a database, log file, or API response.
 *  - All error messages are sanitized before being logged or re-thrown.
 *
 * Structured log events emitted:
 *   [MicrosAuth] token acquisition attempt N/2 failed: <sanitized message>
 *   [MicrosAuth] refresh failure — <sanitized message>. Re-acquiring.
 *   [MicrosAuth] Token obtained via client_credentials. Expires in N min.
 *   [MicrosAuth] Token refreshed via refresh_token grant. Expires in N min.
 *   [MicrosAuth] Authentication failed after 2 attempts.
 *
 * Env vars consumed (all server-side only):
 *   MICROS_AUTH_SERVER        Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_CLIENT_ID          Registered OIDC client ID
 *   MICROS_CLIENT_SECRET      OIDC client secret (required for client_credentials)
 *   MICROS_AUTH_SCOPE         OAuth scope (optional; default: "openid")
 *   MICROS_AUTH_TOKEN_PATH    Token endpoint path override
 *                             (default: /oidc-provider/v1/oauth2/token)
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
        console.warn(`[MicrosAuth] refresh failure — ${safe}. Re-acquiring with client_credentials.`);
        this.state = null;
      }
    }

    // ── Path B: client_credentials grant ─────────────────────────────────────
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await this.executeClientCredentialsGrant();
        this.state = {
          accessToken:  data.access_token,
          refreshToken: data.refresh_token ?? null,
          expiresAt:    Date.now() + data.expires_in * 1000,
        };
        console.info(
          `[MicrosAuth] Token obtained via client_credentials. ` +
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
      `[MicrosAuth] Authentication failed after 2 attempts. ` +
      `Verify MICROS_AUTH_SERVER, MICROS_CLIENT_ID, and MICROS_CLIENT_SECRET ` +
      `are correct and that the client app is registered in Oracle MSAF IDM.`,
    );
  }

  // ── Grant implementations ────────────────────────────────────────────────

  /**
   * OAuth 2.0 Client Credentials grant.
   *
   * Authenticates the registered OIDC application against the Oracle MSAF
   * OIDC provider using client_secret_post method (credentials in body).
   * Requires MICROS_CLIENT_SECRET to be set.
   *
   * Oracle MSAF OIDC discovery confirms:
   *   grant_types_supported: ["client_credentials", "refresh_token", ...]
   *   token_endpoint_auth_methods_supported: ["client_secret_post"]
   *
   * @throws if MICROS_CLIENT_SECRET is not set
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
   * HTTP POST to the OIDC token endpoint.
   *
   * Authentication strategy for the client:
   *  - If a clientSecret is configured: Authorization: Basic base64(id:secret)
   *  - Otherwise: client_id sent in the POST body (public-client mode).
   *
   * `x-requested-by: Oracle` is required by Oracle IDM to bypass the
   * built-in CSRF protection for API (non-browser) clients.
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

    const headers: Record<string, string> = {
      "Content-Type":   "application/x-www-form-urlencoded",
      "x-requested-by": "Oracle",
    };

    // Oracle MSAF OIDC uses client_secret_post (not client_secret_basic).
    // client_id and client_secret always go in the POST body.
    const params = { ...bodyParams };
    params.client_id = clientId;
    if (clientSecret) {
      params.client_secret = clientSecret;
    }

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
      throw new Error(
        `[MicrosAuth] Network error during ${grantLabel}: ` +
        (err instanceof Error && err.name === "AbortError"
          ? "request timed out"
          : "connection failed"),
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const msg = await buildHttpError(res, tokenUrl, grantLabel);
      throw new Error(msg);
    }

    const json = (await res.json()) as _OracleTokenResponse;

    if (!json.access_token) {
      throw new Error(`[MicrosAuth] ${grantLabel} response is missing access_token.`);
    }
    if (typeof json.expires_in !== "number" || json.expires_in <= 0) {
      throw new Error(`[MicrosAuth] ${grantLabel} response has invalid expires_in value.`);
    }

    return json;
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Builds a structured, admin-safe error message from an HTTP error response.
 *
 * Oracle OAuth error bodies (400/401) contain `error` and `error_description`
 * fields that are safe to include — they describe the error, not credentials.
 */
async function buildHttpError(
  res:        Response,
  url:        string,
  grantLabel: string,
): Promise<string> {
  let code = "";
  let desc = "";

  if (res.status === 400 || res.status === 401) {
    try {
      const body = (await res.json()) as { error?: string; error_description?: string };
      if (body?.error)             code = ` [${body.error}]`;
      if (body?.error_description) desc = `: ${body.error_description}`;
    } catch {
      // JSON parse failed — proceed with status-only message
    }
  }

  switch (res.status) {
    case 401:
      return (
        `[MicrosAuth] auth failure (HTTP 401${code})${desc}. ` +
        `Client credentials rejected by Oracle IDM. ` +
        `Verify MICROS_CLIENT_ID and MICROS_CLIENT_SECRET.`
      );
    case 400:
      return (
        `[MicrosAuth] token request failure (HTTP 400${code})${desc}. ` +
        `Invalid request parameters. Check MICROS_CLIENT_ID, MICROS_CLIENT_SECRET, ` +
        `and verify the client app is registered in Oracle MSAF IDM.`
      );
    case 403:
      return (
        `[MicrosAuth] authorize failure (HTTP 403): Access denied. ` +
        `The BI API account may lack the required API access grant in Oracle IDM.`
      );
    case 404:
      return (
        `[MicrosAuth] authorize failure (HTTP 404): Token endpoint not found at ${url}. ` +
        `Check MICROS_AUTH_SERVER and MICROS_AUTH_TOKEN_PATH ` +
        `(default: ${DEFAULT_TOKEN_PATH}).`
      );
    case 405:
      return (
        `[MicrosAuth] authorize failure (HTTP 405): POST rejected at ${url}. ` +
        `Oracle MSAF may be blocking requests from this server's IP address. ` +
        `Contact Oracle support to whitelist your outbound IP, or verify ` +
        `MICROS_AUTH_TOKEN_PATH is set to ${DEFAULT_TOKEN_PATH}.`
      );
    default:
      return `[MicrosAuth] ${grantLabel} failed with HTTP ${res.status}.`;
  }
}

/** Strips long base64/hex strings and URLs that might encode secrets. */
function sanitize(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
    .slice(0, 300);
}

// ── Module singleton ──────────────────────────────────────────────────────
// One instance per Node.js process — ensures the token cache is shared across
// all server-side callers, including concurrent requests.

export const MicrosAuthService = new MicrosAuthServiceImpl();
