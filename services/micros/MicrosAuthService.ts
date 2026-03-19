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
   * Executes the OAuth client_credentials token exchange against Oracle IDCS.
   * Throws on non-2xx or missing access_token.
   * @internal
   */
  private async requestToken(): Promise<_OracleTokenResponse> {
    const cfg = assertMicrosConfigured();

    const tokenUrl = `${cfg.authServer}/oauth2/v1/token`;

    const body = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     cfg.clientId,
      client_secret: cfg.clientSecret,      // secret never leaves this function
      scope:         cfg.orgIdentifier
        ? `${cfg.orgIdentifier}.micros`
        : "micros",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    body.toString(),
        signal:  controller.signal,
      });
    } catch (err) {
      // Network error — sanitize before rethrowing
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
      // Don't log response body — it might reflect the credentials
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
