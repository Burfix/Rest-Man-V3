/**
 * services/micros/MicrosAuthService.ts
 *
 * Oracle MICROS BI API — OpenID Connect token service.
 *
 * Auth flow (Oracle MSAF OIDC — Resource Owner Password Credentials):
 *   1. POST /oidc-provider/v1/oauth2/token with grant_type=password +
 *      BI API account username/password → access_token + refresh_token.
 *   2. On token expiry: POST same endpoint with grant_type=refresh_token.
 *   3. On refresh failure: fall back to step 1 (re-authenticate with password).
 *
 * Security rules:
 *  - MICROS_API_ACCOUNT_PASSWORD is read from env — NEVER logged or exposed.
 *  - MICROS_CLIENT_SECRET is read from env — NEVER logged or exposed.
 *  - access_token and refresh_token are kept in process memory only.
 *    They are NEVER written to a database, log file, or API response.
 *  - All error messages are sanitized before being logged or re-thrown.
 *
 * Structured log events emitted:
 *   [MicrosAuth] sign-in attempt N/2 failed: <sanitized message>
 *   [MicrosAuth] refresh failure — <sanitized message>. Re-authenticating.
 *   [MicrosAuth] Token obtained via ROPC.  Expires in N min.
 *   [MicrosAuth] Token refreshed via refresh_token grant. Expires in N min.
 *   [MicrosAuth] Authentication failed after 2 attempts.
 *
 * Env vars consumed (all server-side only):
 *   MICROS_AUTH_SERVER            Oracle OIDC provider base URL (no trailing slash)
 *   MICROS_CLIENT_ID              Registered OIDC client / app ID
 *   MICROS_CLIENT_SECRET          OIDC client secret (optional; enables Basic Auth)
 *   MICROS_API_ACCOUNT_NAME       BI API account username
 *   MICROS_API_ACCOUNT_PASSWORD   BI API account password  ← required
 *   MICROS_AUTH_SCOPE             OAuth scope (optional; default: "openid")
 *   MICROS_AUTH_TOKEN_PATH        Token endpoint path override
 *                                 (default: /oidc-provider/v1/oauth2/token)
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
   * token has expired; falls back to a full ROPC sign-in when both are
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
   * cheaper refresh grant before falling back to a full ROPC re-auth.
   * Called by MicrosApiClient on HTTP 401 responses.
   */
  async refreshAccessToken(): Promise<string> {
    // Preserve refresh_token so acquireToken() uses it before ROPC.
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
        console.warn(`[MicrosAuth] refresh failure — ${safe}. Re-authenticating with credentials.`);
        this.state = null;
      }
    }

    // ── Path B: ROPC grant (initial sign-in / after refresh failure) ─────────
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
          `[MicrosAuth] Token obtained via ROPC. ` +
          `Expires in ${Math.round(data.expires_in / 60)} min. ` +
          `Attempt ${attempt + 1}/2.` +
          (this.state.refreshToken ? " Refresh token stored." : " No refresh token received."),
        );
        return this.state.accessToken;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const safe = sanitize(lastError.message);
        console.error(`[MicrosAuth] sign-in attempt ${attempt + 1}/2 failed: ${safe}`);
        if (attempt === 0) {
          await delay(1_000);
        }
      }
    }

    throw new Error(
      `[MicrosAuth] Authentication failed after 2 attempts. ` +
      `Verify MICROS_AUTH_SERVER, MICROS_CLIENT_ID, MICROS_API_ACCOUNT_NAME, ` +
      `and MICROS_API_ACCOUNT_PASSWORD are correct and reachable from this server.`,
    );
  }

  // ── Grant implementations ────────────────────────────────────────────────

  /**
   * Resource Owner Password Credentials (ROPC) grant.
   *
   * Authenticates the BI API service account against the Oracle OIDC provider.
   * Requires MICROS_API_ACCOUNT_PASSWORD to be set; throws a descriptive admin-
   * safe error if it is absent.
   *
   * @throws if MICROS_API_ACCOUNT_PASSWORD is not set
   * @internal
   */
  private async executePasswordGrant(): Promise<_OracleTokenResponse> {
    const cfg = assertMicrosConfigured();

    const password = process.env.MICROS_API_ACCOUNT_PASSWORD?.trim();
    if (!password) {
      throw new Error(
        "MICROS credentials incomplete — API account password required. " +
        "Set MICROS_API_ACCOUNT_PASSWORD in your environment variables " +
        "(Vercel project settings → Environment Variables).",
      );
    }

    const body: Record<string, string> = {
      grant_type: "password",
      username:   cfg.apiAccountName,
      password,                                                // account password
      scope:      process.env.MICROS_AUTH_SCOPE?.trim() || "openid",
    };

    return this.postTokenEndpoint(body, cfg.clientId, cfg.clientSecret, cfg.authServer, "sign-in");
  }

  /**
   * Refresh token grant.
   *
   * Exchanges a stored refresh_token for a fresh access_token without
   * re-transmitting the BI API account password.
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

    // Prefer Basic Auth (RFC 6749 §2.3.1); fall back to body client_id for
    // public clients that have no registered secret.
    const params = { ...bodyParams };
    if (clientSecret) {
      const cred = Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64");
      headers["Authorization"] = `Basic ${cred}`;
    } else {
      params.client_id = clientId;
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
        `[MicrosAuth] sign-in failure (HTTP 401${code})${desc}. ` +
        `BI API account credentials rejected by Oracle IDM. ` +
        `Verify MICROS_API_ACCOUNT_NAME and MICROS_API_ACCOUNT_PASSWORD.`
      );
    case 400:
      return (
        `[MicrosAuth] token exchange failure (HTTP 400${code})${desc}. ` +
        `Invalid request parameters. Check MICROS_CLIENT_ID, ` +
        `MICROS_ORG_IDENTIFIER, and MICROS_AUTH_SCOPE.`
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
