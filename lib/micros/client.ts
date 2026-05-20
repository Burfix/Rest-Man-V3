/**
 * lib/micros/client.ts
 *
 * Authenticated HTTP client for Oracle MICROS BIAPI.
 *
 * API calls use:
 *   POST {APP_SERVER}/bi/v1/{orgShortName}/<API Name>
 *   Authorization: Bearer <id_token>
 *   Content-Type: application/json
 *
 * Per Oracle docs, Bearer token is the id_token (NOT access_token).
 *
 * Includes retry with exponential backoff for transient failures.
 */

import { getMicrosIdToken, MicrosAuthError, clearMicrosTokenCache } from "./auth";
import { getMicrosEnvConfig } from "./config";

export { MicrosAuthError } from "./auth";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1_000;

/** HTTP status codes considered transient (worth retrying). */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Builds the base URL for BIAPI calls:
 *   {APP_SERVER}/bi/v1/{orgShortName}
 */
function getBaseUrl(): string {
  const cfg = getMicrosEnvConfig();
  if (!cfg.appServer || !cfg.orgIdentifier) {
    throw new MicrosAuthError(
      "config",
      "MICROS_BI_SERVER or MICROS_ORG_SHORT_NAME is not configured.",
    );
  }
  return `${cfg.appServer}/bi/v1/${cfg.orgIdentifier}`;
}

async function request<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/${path.replace(/^\//, "")}`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Re-acquire token on each attempt (handles 401 → cache clear → re-auth)
    const idToken = await getMicrosIdToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const t0 = Date.now();

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      const elapsed = Date.now() - t0;

      if (!res.ok) {
        // On 401, clear cached token so next attempt re-authenticates
        if (res.status === 401) {
          clearMicrosTokenCache();
        }

        // Retry on transient errors
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(
            `[MicrosClient] ${method} ${path} HTTP ${res.status} (${elapsed}ms) — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
          );
          lastError = new MicrosAuthError(
            "token",
            `BIAPI ${method} ${path} failed (HTTP ${res.status}).`,
            text.slice(0, 500),
            res.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
          );
          await sleep(delay);
          continue;
        }

        throw new MicrosAuthError(
          "token",
          `BIAPI ${method} ${path} failed (HTTP ${res.status}).`,
          text.slice(0, 500),
          res.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
        );
      }

      // Parse JSON response — throw on failure instead of silently returning raw text
      try {
        const parsed = JSON.parse(text) as T;
        if (attempt > 0) {
          console.info(`[MicrosClient] ${method} ${path} succeeded on attempt ${attempt + 1} (${elapsed}ms)`);
        }
        return parsed;
      } catch (parseErr) {
        throw new MicrosAuthError(
          "token",
          `BIAPI ${method} ${path} returned non-JSON response (HTTP ${res.status}).`,
          `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Body prefix: ${text.slice(0, 200)}`,
          "INVALID_RESPONSE",
        );
      }
    } catch (err) {
      clearTimeout(timer);

      // Network / abort errors are retryable
      if (
        err instanceof Error &&
        !(err instanceof MicrosAuthError) &&
        attempt < MAX_RETRIES
      ) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        const isTimeout = err.name === "AbortError";
        console.warn(
          `[MicrosClient] ${method} ${path} ${isTimeout ? "timed out" : "network error"}: ${err.message} — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
        );
        lastError = err;
        await sleep(delay);
        continue;
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error(`BIAPI ${method} ${path} failed after ${MAX_RETRIES + 1} attempts`);
}

export const MicrosApiClient = {
  /**
   * GET request to the BIAPI.
   * Path is relative to /bi/v1/{orgShortName}/
   */
  get: <T = unknown>(path: string): Promise<T> =>
    request<T>("GET", path),

  /**
   * POST request to the BIAPI (most Oracle BI endpoints use POST).
   * Path is relative to /bi/v1/{orgShortName}/
   */
  post: <T = unknown>(path: string, body?: unknown): Promise<T> =>
    request<T>("POST", path, body),
};
