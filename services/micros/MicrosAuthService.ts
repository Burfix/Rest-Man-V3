/**
 * services/micros/MicrosAuthService.ts
 *
 * Oracle MICROS OAuth 2.0 client-credentials token service.
 *
 * Security rules:
 *  - Client secret is read from env var MICROS_CLIENT_SECRET — never logged.
 *  - Tokens are cached in-process memory only — never written to DB or logs.
 *  - Auth failures are logged with a sanitized message (no secrets).
 *
 * Token lifecycle:
 *  - Token is refreshed when fewer than TOKEN_BUFFER_MS remain.
 *  - Parallel callers share one inflight token request (no thundering herd).
 *  - On first failure, the service retries once before propagating the error.
 */

import { assertMicrosConfigured } from "@/lib/micros/config";
import type { _OracleTokenResponse } from "@/types/micros";

// ── Cache ─────────────────────────────────────────────────────────────────

interface TokenCache {
  token:     string;
  expiresAt: number; // unix ms
}

/** Refresh token 5 minutes before it actually expires. */
const TOKEN_BUFFER_MS = 5 * 60 * 1000;

/** Max time to wait for the token endpoint per attempt. */
const AUTH_TIMEOUT_MS = 10_000;

// ── Service class ─────────────────────────────────────────────────────────

class MicrosAuthServiceImpl {
  private cache:           TokenCache | null  = null;
  private inflightRequest: Promise<string> | null = null;

  /**
   * Returns a valid bearer token for MICROS API calls.
   * Uses the in-memory cache when still valid; fetches a new token otherwise.
   * Parallel callers share one inflight request.
   */
  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.cache!.token;
    }

    // Deduplicate concurrent callers — all await the same inflight promise.
    if (this.inflightRequest) {
      return this.inflightRequest;
    }

    this.inflightRequest = this.fetchAndCache();

    try {
      return await this.inflightRequest;
    } finally {
      this.inflightRequest = null;
    }
  }

  /**
   * Forces a new token fetch, replacing any cached value.
   * Called automatically by MicrosApiClient on 401 responses.
   */
  async refreshAccessToken(): Promise<string> {
    this.clearCache();
    return this.getAccessToken();
  }

  /**
   * Returns true if the cached token is present and has more than
   * TOKEN_BUFFER_MS remaining.
   */
  isTokenValid(): boolean {
    return (
      this.cache !== null &&
      this.cache.expiresAt - Date.now() > TOKEN_BUFFER_MS
    );
  }

  /** Clears the in-memory token cache (e.g., on 401 response). */
  clearCache(): void {
    this.cache = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetchAndCache(): Promise<string> {
    let lastError: Error | null = null;

    // Retry once on transient auth failure
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const tokenData = await this.requestToken();
        const expiresAt = Date.now() + tokenData.expires_in * 1000;

        this.cache = { token: tokenData.access_token, expiresAt };

        // Log success without exposing the token value
        console.info(
          `[MicrosAuth] Token obtained. ` +
          `Expires in ${Math.round(tokenData.expires_in / 60)} min. ` +
          `Attempt ${attempt + 1}/2.`,
        );

        return tokenData.access_token;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Sanitize: never log the error message if it might contain the secret
        const safeMsg = this.sanitizeErrorMessage(lastError.message);
        console.error(`[MicrosAuth] Token fetch failed (attempt ${attempt + 1}/2): ${safeMsg}`);

        if (attempt === 0) {
          // Brief pause before retry
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
    }

    throw new Error(
      `[MicrosAuth] Authentication failed after 2 attempts. ` +
      `Check MICROS_AUTH_SERVER, MICROS_CLIENT_ID, and MICROS_CLIENT_SECRET.`,
    );
  }

  /**
   * Executes the OAuth client_credentials token exchange against Oracle IDCS /
   * Oracle MSAF IDM.
   *
   * Oracle's IDM server (including ors-idm.msaf.oraclerestaurants.com) requires
   * RFC 6749 §2.3.1 client authentication: credentials in the
   * `Authorization: Basic` header, NOT in the request body.  Placing
   * client_id / client_secret in the body causes the Jetty default servlet to
   * intercept the request and return HTTP 405.
   *
   * Additionally Oracle IDM requires:
   *   - `x-requested-by: XMLHttpRequest`  (CSRF guard bypass for API clients)
   *   - scope omitted or set to a meaningful value — we default to omitting it
   *     so the server grants its default scopes; override via MICROS_AUTH_SCOPE.
   *
   * The token path can be overridden via MICROS_AUTH_TOKEN_PATH env var
   * (default: /oauth2/v1/token).
   *
   * @internal
   */
  private async requestToken(): Promise<_OracleTokenResponse> {
    const cfg = assertMicrosConfigured();

    const tokenPath = process.env.MICROS_AUTH_TOKEN_PATH?.trim() || "/oauth2/v1/token";
    const tokenUrl  = `${cfg.authServer}${tokenPath}`;

    // RFC 6749 §2.3.1 — credentials in Authorization: Basic header
    const basicCred = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, "utf-8").toString("base64");

    // Body: grant_type only; scope is optional and often causes 400 on Oracle MSAF
    const bodyParams: Record<string, string> = { grant_type: "client_credentials" };
    const customScope = process.env.MICROS_AUTH_SCOPE?.trim();
    if (customScope) bodyParams.scope = customScope;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    // Oracle IDM requires x-requested-by to bypass CSRF protection.
    // Oracle Simphony BI API documentation specifies "Oracle" as the value.
    // Override via MICROS_AUTH_REQUESTED_BY env var if your deployment differs.
    const requestedBy = process.env.MICROS_AUTH_REQUESTED_BY?.trim() || "Oracle";

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method:  "POST",
        headers: {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Authorization":  `Basic ${basicCred}`,
          // Oracle IDM CSRF guard — required for non-browser API clients
          "x-requested-by": requestedBy,
        },
        body:   new URLSearchParams(bodyParams).toString(),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `[MicrosAuth] Network error reaching auth server: ${
          err instanceof Error && err.name === "AbortError"
            ? "request timed out"
            : "connection failed"
        }`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // For 401/403 the body might echo credential info — don't include it.
      // For 404/405 (routing errors) the body is a generic server error page
      // and is safe to include for diagnostics.
      if (res.status === 405) {
        throw new Error(
          `[MicrosAuth] Auth server returned HTTP 405 (Method Not Allowed) for POST ${tokenUrl}. ` +
          `This typically means the token endpoint path is blocked for this source IP. ` +
          `Oracle MSAF restricts API access to whitelisted IPs. ` +
          `Contact Oracle support to whitelist your server's outbound IP, or check ` +
          `MICROS_AUTH_TOKEN_PATH is correct (default: /oauth2/v1/token).`,
        );
      }
      if (res.status === 404) {
        throw new Error(
          `[MicrosAuth] Auth server returned HTTP 404 for POST ${tokenUrl}. ` +
          `The token endpoint path may be incorrect. ` +
          `Check MICROS_AUTH_TOKEN_PATH (current: ${tokenPath}) or MICROS_AUTH_SERVER.`,
        );
      }
      // For other failures (401, 403, 5xx) keep it terse — body may echo credentials
      throw new Error(`[MicrosAuth] Auth server returned HTTP ${res.status}.`);
    }

    const json = (await res.json()) as _OracleTokenResponse;

    if (!json.access_token) {
      throw new Error("[MicrosAuth] Token response missing access_token field.");
    }
    if (typeof json.expires_in !== "number" || json.expires_in <= 0) {
      throw new Error("[MicrosAuth] Token response has invalid expires_in value.");
    }

    return json;
  }

  /**
   * Strips anything that might be a secret from an error message before logging.
   * Conservative: replaces long hex/base64 substrings and full URLs.
   */
  private sanitizeErrorMessage(msg: string): string {
    return msg
      .replace(/https?:\/\/[^\s]+/g, "<url>")
      .replace(/[A-Za-z0-9+/=]{40,}/g, "<redacted>")
      .slice(0, 300);
  }
}

// ── Module singleton ──────────────────────────────────────────────────────
// A single instance ensures the token cache is shared across all server-side
// callers within the same Node.js process (including concurrent requests).

export const MicrosAuthService = new MicrosAuthServiceImpl();
