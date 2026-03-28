/**
 * services/micros/imClient.ts
 *
 * Oracle MICROS Inventory Management (IM) client.
 *
 * Uses the SAME PKCE / Bearer token auth as the BI API (standard RNA
 * credentials) — NO separate API user or Basic Auth.
 *
 * Endpoint: GET /im/v1/{orgShortName}/GetStockOnHandList
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 *
 * The IM module lives on the same server as the BI API but under /im/v1
 * instead of /bi/v1.  Auth tokens are interchangeable.
 */

import { getMicrosIdToken, clearMicrosTokenCache } from "@/lib/micros/auth";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { logger } from "@/lib/logger";
import type { OracleStockOnHand } from "./inventory/types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface IMStockOnHandParams {
  /** Item identifier — required by Oracle API spec */
  item?: number;
  /** Cost center filter — optional; omit for all cost centers */
  costCenter?: number;
}

export interface IMStockResult {
  ok: boolean;
  items: OracleStockOnHand[];
  errorMessage?: string;
  httpStatus?: number;
  durationMs: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_IM_API_PATH = "/im/v1";

// ── URL builder ─────────────────────────────────────────────────────────────

/**
 * Builds the IM API base URL:
 *   {server}/im/v1/{orgShortName}
 *
 * Uses MICROS_IM_SERVER if set, otherwise falls back to MICROS_BI_SERVER
 * (same host, different path prefix).
 */
function getImBaseUrl(): string {
  const cfg = getMicrosEnvConfig();
  const server =
    (process.env.MICROS_IM_SERVER ?? "").trim().replace(/\/$/, "") ||
    cfg.appServer;

  if (!server) {
    throw new Error("MICROS_BI_SERVER (or MICROS_IM_SERVER) is not configured.");
  }
  if (!cfg.orgIdentifier) {
    throw new Error("MICROS_ORG_SHORT_NAME is not configured.");
  }

  const apiPath =
    (process.env.MICROS_IM_API_PATH ?? "").trim().replace(/\/$/, "") ||
    DEFAULT_IM_API_PATH;

  return `${server}${apiPath}/${cfg.orgIdentifier}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── API Call ────────────────────────────────────────────────────────────────

/**
 * Calls Oracle IM GetStockOnHandList.
 *
 * Auth: Bearer id_token from the standard RNA PKCE flow (same as BI API).
 * Method: GET with query parameters (per OPTIONS probe: Allow GET, HEAD, OPTIONS).
 *
 * Supports retry with token refresh on 401.
 */
export async function fetchStockOnHand(
  params: IMStockOnHandParams = {},
  meta?: { requestId?: string; siteId?: string },
): Promise<IMStockResult> {
  const startMs = Date.now();

  // Build URL with query params
  const baseUrl = getImBaseUrl();
  const url = new URL(`${baseUrl}/GetStockOnHandList`);
  if (params.item !== undefined) url.searchParams.set("item", String(params.item));
  if (params.costCenter !== undefined) url.searchParams.set("costCenter", String(params.costCenter));

  logger.info("MICROS IM API call starting", {
    endpoint: "GetStockOnHandList",
    authMode: "pkce-bearer",
    hasItem: params.item !== undefined,
    hasCostCenter: params.costCenter !== undefined,
    requestId: meta?.requestId,
    siteId: meta?.siteId,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const idToken = await getMicrosIdToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      const text = await res.text();
      const durationMs = Date.now() - startMs;

      if (!res.ok) {
        // Clear token on 401 so next attempt re-authenticates via PKCE
        if (res.status === 401) clearMicrosTokenCache();

        // ── Diagnostic logging for auth/access failures ──────────────
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          const diagnosisHint =
            res.status === 401
              ? "LIKELY CAUSE: Token invalid or expired. The PKCE id_token may not be accepted by the IM module, or the token was issued for a different scope/audience. Check if the IM module requires a different OAuth scope than 'openid'."
              : res.status === 403
              ? "LIKELY CAUSE: Token valid but insufficient permissions. The RNA user may not have the IM module role/privilege assigned in Simphony EMC. Check Enterprise > Users > Roles for inventory access."
              : "LIKELY CAUSE: IM module not provisioned for this org, or wrong endpoint path. Verify with Oracle support that IM POS Web Services is enabled for org '" + getMicrosEnvConfig().orgIdentifier + "'. The /im/v1 path may differ — ask MICROS team for the correct IM service URL.";

          logger.error("MICROS IM API auth/access diagnostic", {
            httpStatus: res.status,
            diagnosisHint,
            endpoint: url.toString(),
            tokenPrefix: idToken.slice(0, 20) + "...",
            tokenLength: idToken.length,
            authHeader: "Bearer <id_token>",
            responseHeaders: {
              "www-authenticate": res.headers.get("www-authenticate") ?? "absent",
              "x-oracle-error": res.headers.get("x-oracle-error") ?? "absent",
              "content-type": res.headers.get("content-type") ?? "absent",
            },
            responsePreview: text.slice(0, 500),
            requestId: meta?.requestId,
            siteId: meta?.siteId,
            attempt: attempt + 1,
          });
        }

        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          logger.warn("MICROS IM API transient error, retrying", {
            httpStatus: res.status,
            attempt: attempt + 1,
            delayMs: delay,
            requestId: meta?.requestId,
          });
          lastError = new Error(`IM API HTTP ${res.status}`);
          await sleep(delay);
          continue;
        }

        logger.error("MICROS IM API returned non-200", {
          httpStatus: res.status,
          durationMs,
          responsePreview: text.slice(0, 300),
          requestId: meta?.requestId,
          siteId: meta?.siteId,
        });

        return {
          ok: false,
          items: [],
          errorMessage: `IM API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
          httpStatus: res.status,
          durationMs,
        };
      }

      // Parse response
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        logger.error("MICROS IM API returned non-JSON", {
          durationMs,
          responsePreview: text.slice(0, 200),
          requestId: meta?.requestId,
        });
        return {
          ok: false,
          items: [],
          errorMessage: "IM API returned non-JSON response",
          durationMs,
        };
      }

      // Oracle IM can wrap in { Success, Data } or return array directly
      const success = parsed.Success ?? parsed.success;
      if (success === false) {
        const msg = String(parsed.Message ?? parsed.message ?? "GetStockOnHandList returned an error");
        logger.warn("MICROS IM API returned success=false", {
          durationMs,
          message: msg.slice(0, 300),
          requestId: meta?.requestId,
        });
        return { ok: false, items: [], errorMessage: msg, durationMs };
      }

      // Extract items — handle array-at-root, { Data: [...] }, or { data: [...] }
      let items: OracleStockOnHand[];
      if (Array.isArray(parsed)) {
        items = parsed;
      } else {
        items = (parsed.Data ?? parsed.data ?? []) as OracleStockOnHand[];
      }

      logger.info("MICROS IM API call succeeded", {
        itemCount: items.length,
        durationMs,
        requestId: meta?.requestId,
        siteId: meta?.siteId,
      });

      return { ok: true, items, durationMs };
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      const isAbort = err instanceof DOMException && err.name === "AbortError";

      if (!isAbort && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        logger.warn("MICROS IM API network error, retrying", {
          error: err instanceof Error ? err.message : String(err),
          attempt: attempt + 1,
          delayMs: delay,
          requestId: meta?.requestId,
        });
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(delay);
        continue;
      }

      const message = isAbort
        ? `IM API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);

      logger.error("MICROS IM API call failed", {
        err: isAbort ? undefined : err,
        message,
        durationMs,
        requestId: meta?.requestId,
        siteId: meta?.siteId,
      });

      return { ok: false, items: [], errorMessage: message, durationMs };
    } finally {
      clearTimeout(timer);
    }
  }

  // Exhausted retries
  const durationMs = Date.now() - startMs;
  const msg = lastError?.message ?? "IM API failed after retries";
  return { ok: false, items: [], errorMessage: msg, durationMs };
}

// ── Convenience: fetch for a specific item ──────────────────────────────────

/**
 * GetStockOnHandList for a specific item, optionally filtered by cost center.
 * This is the primary method the service layer should call.
 */
export async function getStockOnHandList(
  itemId: number,
  costCenterId?: number,
  meta?: { requestId?: string; siteId?: string },
): Promise<IMStockResult> {
  return fetchStockOnHand(
    { item: itemId, costCenter: costCenterId },
    meta,
  );
}

/**
 * Fetch stock on hand for ALL items (no item filter).
 * Used by the bulk sync flow.
 */
export async function fetchAllStockOnHand(
  meta?: { requestId?: string; siteId?: string },
): Promise<IMStockResult> {
  return fetchStockOnHand({}, meta);
}
