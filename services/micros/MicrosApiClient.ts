/**
 * services/micros/MicrosApiClient.ts
 *
 * Base HTTP client for all Oracle MICROS BI API calls.
 *
 * Responsibilities:
 *  - Attaches Bearer token via MicrosAuthService (in-memory cache)
 *  - Injects required Oracle headers: Authorization, x-app-key, x-hotelid
 *  - Builds request URLs from MICROS_APP_SERVER + orgIdentifier
 *  - 401 response → refreshes token and retries once
 *  - 5xx response → retries once with back-off
 *  - Logs structured errors (never logs token or secret values)
 *
 * NEVER import this in client components.
 */

import { getMicrosConfig }    from "@/lib/micros/config";
import { MicrosAuthService }  from "./MicrosAuthService";

// ── Config ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS  = 15_000;
const RETRY_DELAY_MS      = 1_000;

// ── Client class ──────────────────────────────────────────────────────────

class MicrosApiClientImpl {

  /**
   * Authenticated GET against the MICROS BI app server.
   *
   * @param path      Path segment, e.g. "/rms/v1/reports/dailyBusinessSummary"
   * @param params    Query string params merged with locRef
   * @param locRef    Override locRef (falls back to MICROS_LOC_REF env var)
   */
  async get<T = unknown>(
    path:     string,
    params?:  Record<string, string>,
    locRef?:  string,
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, params, locRef);
  }

  /**
   * Authenticated POST against the MICROS BI app server.
   *
   * @param path   Path segment
   * @param body   JSON-serialisable request body
   * @param locRef Override locRef (falls back to MICROS_LOC_REF env var)
   */
  async post<T = unknown>(
    path:    string,
    body:    unknown,
    locRef?: string,
  ): Promise<T> {
    return this.request<T>("POST", path, body, undefined, locRef);
  }

  // ── Core request logic ───────────────────────────────────────────────────

  private async request<T>(
    method:   "GET" | "POST",
    path:     string,
    body?:    unknown,
    params?:  Record<string, string>,
    locRef?:  string,
  ): Promise<T> {
    let token = await MicrosAuthService.getAccessToken();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.executeRequest(method, path, token, params, body, locRef);

        // ── 401: refresh token and retry once ─────────────────────────────
        if (res.status === 401 && attempt === 0) {
          console.warn("[MicrosApiClient] Received 401 — refreshing token and retrying.");
          token = await MicrosAuthService.refreshAccessToken();
          continue;
        }

        // ── 5xx: retry once ───────────────────────────────────────────────
        if (res.status >= 500 && attempt === 0) {
          console.warn(`[MicrosApiClient] Received ${res.status} — retrying in ${RETRY_DELAY_MS}ms.`);
          await delay(RETRY_DELAY_MS);
          continue;
        }

        // ── 4xx (non-401): hard failure ───────────────────────────────────
        if (res.status === 404) {
          throw new Error(`[MicrosApiClient] Endpoint not found: ${path}`);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(
            `[MicrosApiClient] Request failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
          );
        }

        return (await res.json()) as T;

      } catch (err) {
        if (attempt < 1 && isRetryableNetworkError(err)) {
          console.warn(`[MicrosApiClient] Network error on attempt ${attempt + 1} — retrying.`);
          await delay(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }

    // Should never reach here — loop handles both success and throws
    throw new Error("[MicrosApiClient] Unexpected request loop exhausted.");
  }

  private async executeRequest(
    method:   "GET" | "POST",
    path:     string,
    token:    string,
    params?:  Record<string, string>,
    body?:    unknown,
    locRef?:  string,
  ): Promise<Response> {
    const cfg       = getMicrosConfig();
    const effectiveLocRef = locRef ?? cfg.locRef;
    const url       = this.buildUrl(cfg.appServer, path, effectiveLocRef, params);
    const headers   = this.buildHeaders(token, cfg.orgIdentifier, cfg.apiAccountName, effectiveLocRef);

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`[MicrosApiClient] Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── URL + header builders ────────────────────────────────────────────────

  private buildUrl(
    base:    string,
    path:    string,
    locRef:  string,
    params?: Record<string, string>,
  ): string {
    const url = new URL(`${base}${path}`);
    url.searchParams.set("locRef", locRef);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  private buildHeaders(
    token:          string,
    orgIdentifier:  string,
    apiAccountName: string,
    locRef:         string,
  ): Record<string, string> {
    return {
      "Authorization": `Bearer ${token}`,
      "x-app-key":     apiAccountName || orgIdentifier, // prefer apiAccountName, fall back to org
      "x-hotelid":     locRef,
      "Accept":        "application/json",
      "Content-Type":  "application/json",
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("fetch failed") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("ECONNREFUSED") ||
    err.message.includes("network error") ||
    err.message.includes("timeout")
  );
}

// ── Module singleton ──────────────────────────────────────────────────────

export const MicrosApiClient = new MicrosApiClientImpl();
