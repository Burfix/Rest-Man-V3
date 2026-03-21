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
 */

import { getMicrosIdToken, MicrosAuthError } from "./auth";
import { getMicrosEnvConfig } from "./config";

export { MicrosAuthError } from "./auth";

const REQUEST_TIMEOUT_MS = 30_000;

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
  const idToken = await getMicrosIdToken();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/${path.replace(/^\//, "")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

    if (!res.ok) {
      throw new MicrosAuthError(
        "token",
        `BIAPI ${method} ${path} failed (HTTP ${res.status}).`,
        text.slice(0, 500),
        res.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } finally {
    clearTimeout(timer);
  }
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
