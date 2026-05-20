/**
 * lib/micros/location-client.ts
 *
 * Per-location authenticated HTTP client for Oracle MICROS BIAPI.
 *
 * Usage:
 *   const client = buildLocationClient(cfg);
 *   const data = await client.post("getGuestChecks", { busDt, locRef });
 *
 * SECURITY: This module is SERVER-ONLY. Never import in client components.
 */

import { acquireLocationToken, clearLocationTokenCache, LocationAuthError } from "./location-auth";
import type { LocationConfig, LocationKey } from "./micros-location-registry";

export { LocationAuthError } from "./location-auth";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES        = 2;
const RETRY_BASE_MS      = 1_000;
const RETRYABLE_STATUS   = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getBiApiBaseUrl(cfg: LocationConfig): string {
  if (!cfg.baseUrl || !cfg.enterpriseShortName) {
    throw new LocationAuthError(
      cfg.key, "config",
      "baseUrl or enterpriseShortName is missing from location config.",
    );
  }
  return `${cfg.baseUrl}/bi/v1/${cfg.enterpriseShortName}`;
}

async function request<T = unknown>(
  cfg: LocationConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = getBiApiBaseUrl(cfg);
  const url     = `${baseUrl}/${path.replace(/^\//, "")}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const bearerToken = await acquireLocationToken(cfg);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const t0 = Date.now();

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text    = await res.text();
      const elapsed = Date.now() - t0;

      if (!res.ok) {
        if (res.status === 401) {
          clearLocationTokenCache(cfg.key);
        }
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(`[LocationClient:${cfg.key}] ${method} ${path} HTTP ${res.status} (${elapsed}ms) — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
          lastError = new LocationAuthError(cfg.key, "token", `BIAPI ${method} ${path} HTTP ${res.status}.`, text.slice(0, 300));
          await sleep(delay);
          continue;
        }
        throw new LocationAuthError(
          cfg.key, "token",
          `BIAPI ${method} ${path} failed (HTTP ${res.status}).`,
          text.slice(0, 500),
        );
      }

      try {
        return JSON.parse(text) as T;
      } catch (parseErr) {
        throw new LocationAuthError(
          cfg.key, "token",
          `BIAPI ${method} ${path} returned non-JSON (HTTP ${res.status}).`,
          `Parse: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Body: ${text.slice(0, 200)}`,
        );
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && !(err instanceof LocationAuthError) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        const isTimeout = err.name === "AbortError";
        console.warn(`[LocationClient:${cfg.key}] ${method} ${path} ${isTimeout ? "timed out" : "network error"}: ${err.message} — retry ${attempt + 1}`);
        lastError = err;
        await sleep(delay);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`[LocationClient:${cfg.key}] ${method} ${path} failed after ${MAX_RETRIES + 1} attempts`);
}

export interface LocationBiApiClient {
  get:  <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

/**
 * Creates a BIAPI client bound to the given location config.
 * Handles token acquisition, retry, and 401 cache-clearing automatically.
 */
export function buildLocationClient(cfg: LocationConfig): LocationBiApiClient {
  return {
    get:  <T>(path: string) => request<T>(cfg, "GET", path),
    post: <T>(path: string, body?: unknown) => request<T>(cfg, "POST", path, body),
  };
}

/**
 * Fetches guest checks for a given business date and location ref.
 * Returns the raw Oracle response shape.
 */
export async function fetchGuestChecks(
  cfg: LocationConfig,
  businessDate: string,
): Promise<{ curUTC: string; locRef: string; guestChecks: unknown[] | null }> {
  const client = buildLocationClient(cfg);
  return client.post<{ curUTC: string; locRef: string; guestChecks: unknown[] | null }>(
    "getGuestChecks",
    { busDt: businessDate, locRef: cfg.locationRef },
  );
}

/**
 * Fetches time card details for a given business date and location ref.
 */
export async function fetchTimeCardDetails(
  cfg: LocationConfig,
  businessDate: string,
): Promise<unknown> {
  const client = buildLocationClient(cfg);
  return client.post("getTimeCardDetails", { busDt: businessDate, locRef: cfg.locationRef });
}

/**
 * Fetches job code dimensions for a location ref.
 */
export async function fetchJobCodeDimensions(cfg: LocationConfig): Promise<unknown> {
  const client = buildLocationClient(cfg);
  return client.post("getJobCodeDimensions", { locRef: cfg.locationRef });
}
