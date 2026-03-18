/**
 * services/micros/client.ts
 *
 * Base HTTP client for Oracle MICROS BI API calls.
 * - Injects Bearer token on every request
 * - Adds required Oracle headers (x-app-key, x-hotelid)
 * - Retry with exponential back-off on transient errors (502, 503, 504)
 * - Hard timeout of 15 s per attempt
 */

import { getMicrosToken } from "./auth";

const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 500;
const TIMEOUT_MS    = 15_000;

interface RequestOptions {
  connectionId:   string;
  appServerUrl:   string;
  orgIdentifier:  string;
  locRef:         string;
  path:           string;           // e.g. "/rms/v1/reports/dailyBusinessSummary"
  params?:        Record<string, string>;
}

/**
 * Makes an authenticated GET request to the MICROS BI app server.
 * Retries on 5xx transient errors.
 */
export async function microsGet<T = unknown>(opts: RequestOptions): Promise<T> {
  const token       = await getMicrosToken(opts.connectionId);
  const base        = opts.appServerUrl.replace(/\/$/, "");
  const url         = new URL(`${base}${opts.path}`);

  // Standard query params
  url.searchParams.set("locRef", opts.locRef);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  let lastError: Error = new Error("Unknown error");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
    }

    try {
      const res = await fetchWithTimeout(url.toString(), {
        method:  "GET",
        headers: {
          "Authorization":  `Bearer ${token}`,
          "x-app-key":      opts.orgIdentifier,
          "x-hotelid":      opts.locRef,
          "Accept":         "application/json",
          "Content-Type":   "application/json",
        },
      });

      if (res.status === 401 || res.status === 403) {
        throw new Error(`MICROS API auth error (${res.status}) — check credentials.`);
      }

      if (res.status === 404) {
        throw new Error(`MICROS endpoint not found: ${opts.path}`);
      }

      if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
        lastError = new Error(`MICROS server error (${res.status})`);
        continue; // retry
      }

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`MICROS API error (${res.status}): ${text.slice(0, 200)}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof Error && !isRetryable(err)) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError;
}

function isRetryable(err: Error): boolean {
  return (
    err.message.includes("fetch failed") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("timeout") ||
    err.message.includes("server error")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}
