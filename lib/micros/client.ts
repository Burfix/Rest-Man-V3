/**
 * lib/micros/client.ts
 *
 * Oracle MICROS BI API — authenticated HTTP client.
 *
 * - Every request gets a valid access_token via getMicrosAccessToken().
 * - Authorization header: Bearer <access_token>
 * - Required Oracle headers: x-app-key (org short name), x-hotelid (locRef)
 * - 401 response → clear cache, re-authenticate, retry once
 * - 5xx response → retry once with 1 s back-off
 * - Hard timeout: 20 s per attempt
 *
 * Base URL: MICROS_BI_SERVER / bi/v1 / {orgShortName} / ...
 * (set MICROS_BI_SERVER without trailing slash)
 *
 * SERVER-SIDE ONLY.  Never import in client components.
 */

import { getMicrosAccessToken, clearMicrosTokenCache, MicrosAuthError } from "./auth";

// ── Config ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS     = 1_000;

// ── Helpers ───────────────────────────────────────────────────────────────

function getBiServer(): string {
  return (process.env.MICROS_BI_SERVER ?? process.env.MICROS_APP_SERVER ?? "").replace(/\/$/, "");
}

function getOrgShortName(): string {
  return process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? "";
}

function getLocRef(): string {
  return process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "";
}

// ── Client ────────────────────────────────────────────────────────────────

class MicrosApiClientImpl {
  /**
   * Authenticated GET to the Oracle MICROS BI API.
   *
   * @param path    Relative path, e.g. "/reports/dailyBusinessSummary"
   *                Full URL built as: {MICROS_BI_SERVER}/bi/v1/{orgShortName}{path}
   * @param params  Additional query params (merged with locRef)
   * @param locRef  Override locRef (defaults to MICROS_LOCATION_REF)
   */
  async get<T = unknown>(
    path:    string,
    params?: Record<string, string>,
    locRef?: string,
  ): Promise<T> {
    return this.request<T>("GET", path, undefined, params, locRef);
  }

  /**
   * Authenticated POST to the Oracle MICROS BI API.
   *
   * @param path  Relative path
   * @param body  JSON-serialisable request body
   */
  async post<T = unknown>(
    path:   string,
    body?:  unknown,
    locRef?: string,
  ): Promise<T> {
    return this.request<T>("POST", path, body, undefined, locRef);
  }

  // ── Core request ──────────────────────────────────────────────────────

  private async request<T>(
    method:   string,
    path:     string,
    body?:    unknown,
    params?:  Record<string, string>,
    locRefOverride?: string,
  ): Promise<T> {
    const biServer   = getBiServer();
    const orgName    = getOrgShortName();
    const locRef     = locRefOverride ?? getLocRef();

    if (!biServer) throw new Error("[MicrosClient] MICROS_BI_SERVER is not configured.");
    if (!orgName)  throw new Error("[MicrosClient] MICROS_ORG_SHORT_NAME is not configured.");

    const url = buildUrl(biServer, orgName, path, locRef, params);

    // First attempt — get a valid access token.
    const accessToken = await getMicrosAccessToken();
    const res = await this.doFetch(method, url, accessToken, body);

    if (res.status === 401) {
      // Token rejected — clear cache, re-authenticate, retry once.
      console.warn("[MicrosClient] 401 on first attempt — clearing token cache and retrying.");
      clearMicrosTokenCache();
      await delay(RETRY_DELAY_MS);
      const freshToken = await getMicrosAccessToken();
      const retryRes   = await this.doFetch(method, url, freshToken, body);
      return this.parseResponse<T>(retryRes, url);
    }

    if (res.status >= 500) {
      console.warn(`[MicrosClient] ${res.status} on first attempt — retrying once.`);
      await delay(RETRY_DELAY_MS);
      const retryRes = await this.doFetch(method, url, accessToken, body);
      return this.parseResponse<T>(retryRes, url);
    }

    return this.parseResponse<T>(res, url);
  }

  private async doFetch(
    method:       string,
    url:          URL,
    accessToken:  string,
    body?:        unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${accessToken}`,
      "x-app-key":     getOrgShortName(),
      "x-hotelid":     getLocRef(),
      "Accept":        "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url.toString(), {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`[MicrosClient] Request timed out after ${REQUEST_TIMEOUT_MS}ms (${url.pathname})`);
      }
      throw new Error(`[MicrosClient] Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseResponse<T>(res: Response, url: URL): Promise<T> {
    if (res.ok) {
      // Some endpoints return 204 No Content
      if (res.status === 204) return {} as T;
      return res.json() as Promise<T>;
    }

    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }

    const excerpt = body
      .replace(/<[^>]+>/g, " ")
      .replace(/[A-Za-z0-9+/=]{40,}/g, "<token>")
      .slice(0, 200);

    throw new Error(
      `[MicrosClient] ${res.status} ${res.statusText} — ${url.pathname}. Body: ${excerpt}`,
    );
  }
}

// ── URL builder ───────────────────────────────────────────────────────────

function buildUrl(
  biServer: string,
  orgName:  string,
  path:     string,
  locRef:   string,
  params?:  Record<string, string>,
): URL {
  // Canonical base: {biServer}/bi/v1/{orgName}
  const base = `${biServer}/bi/v1/${orgName}${path.startsWith("/") ? path : `/${path}`}`;
  const url  = new URL(base);
  if (locRef) url.searchParams.set("locRef", locRef);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const MicrosApiClient = new MicrosApiClientImpl();

// Re-export auth error for callers that need to inspect failure stage.
export { MicrosAuthError };
