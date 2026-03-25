/**
 * services/micros/imClient.ts
 *
 * Dedicated Oracle MICROS Inventory Management (IM) POS Web Services client.
 *
 * Separate from the BI API client — the IM module has its own base URL,
 * credentials, and endpoint structure.
 *
 * Endpoint: POST GetStockOnHandList
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 *
 * Configuration sources (in priority order):
 *   1. Site-level config from DB (micros_connections row)
 *   2. Environment variables: MICROS_IM_SERVER, MICROS_IM_API_PATH, etc.
 *
 * Required env vars (or DB config):
 *   MICROS_IM_SERVER     — IM service base URL (may differ from BI server)
 *   MICROS_IM_API_PATH   — API path prefix (default: "/im/v1")
 *   MICROS_IM_USERNAME   — IM service account username
 *   MICROS_IM_PASSWORD   — IM service account password
 */

import { logger } from "@/lib/logger";
import type { OracleStockOnHand } from "./inventory/types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface IMClientConfig {
  serverUrl: string;
  apiPath: string;
  orgIdentifier: string;
  username: string;
  password: string;
}

export interface IMStockOnHandParams {
  item?: number;
  costCenter?: number;
  locationCode?: string;
}

interface OracleIMResponse {
  Success?: boolean;
  success?: boolean;
  Message?: string;
  message?: string;
  Data?: OracleStockOnHand[];
  data?: OracleStockOnHand[];
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
const DEFAULT_API_PATH = "/im/v1";

// ── Config resolution ───────────────────────────────────────────────────────

/**
 * Resolves IM client configuration from DB config or environment variables.
 * DB config takes priority when provided.
 */
export function resolveIMConfig(dbConfig?: {
  app_server_url?: string;
  org_identifier?: string;
} | null): IMClientConfig {
  const serverUrl =
    (process.env.MICROS_IM_SERVER ?? "").trim().replace(/\/$/, "") ||
    dbConfig?.app_server_url?.replace(/\/$/, "") ||
    "";

  const apiPath =
    (process.env.MICROS_IM_API_PATH ?? "").trim().replace(/\/$/, "") ||
    DEFAULT_API_PATH;

  const orgIdentifier =
    (process.env.MICROS_ORG_SHORT_NAME ?? process.env.MICROS_ORG_IDENTIFIER ?? "").trim() ||
    dbConfig?.org_identifier ||
    "";

  const username = (process.env.MICROS_IM_USERNAME ?? "").trim();
  const password = (process.env.MICROS_IM_PASSWORD ?? "").trim();

  return { serverUrl, apiPath, orgIdentifier, username, password };
}

/**
 * Validates that all required IM config fields are present.
 */
export function validateIMConfig(cfg: IMClientConfig): string[] {
  const missing: string[] = [];
  if (!cfg.serverUrl) missing.push("MICROS_IM_SERVER");
  if (!cfg.orgIdentifier) missing.push("MICROS_ORG_SHORT_NAME");
  if (!cfg.username) missing.push("MICROS_IM_USERNAME");
  if (!cfg.password) missing.push("MICROS_IM_PASSWORD");
  return missing;
}

// ── API Call ────────────────────────────────────────────────────────────────

/**
 * Calls the Oracle IM GetStockOnHandList endpoint.
 *
 * Uses HTTP Basic Auth (IM module uses its own credential scheme,
 * separate from the BI API PKCE flow).
 */
export async function fetchStockOnHand(
  cfg: IMClientConfig,
  params: IMStockOnHandParams = {},
  meta?: { requestId?: string; siteId?: string },
): Promise<IMStockResult> {
  const url = `${cfg.serverUrl}${cfg.apiPath}/${cfg.orgIdentifier}/GetStockOnHandList`;
  const startMs = Date.now();

  const body: Record<string, unknown> = {};
  if (params.item !== undefined) body.item = params.item;
  if (params.costCenter !== undefined) body.costCenter = params.costCenter;
  if (params.locationCode) body.locationCode = params.locationCode;

  const basicAuth = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  logger.info("MICROS IM API call starting", {
    url: url.replace(/\/[^/]+$/, "/GetStockOnHandList"), // redact org from logs
    requestId: meta?.requestId,
    siteId: meta?.siteId,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      logger.error("MICROS IM API returned non-200", {
        httpStatus: res.status,
        durationMs,
        requestId: meta?.requestId,
        siteId: meta?.siteId,
      });
      return {
        ok: false,
        items: [],
        errorMessage: `IM API returned HTTP ${res.status}`,
        httpStatus: res.status,
        durationMs,
      };
    }

    let parsed: OracleIMResponse;
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

    const success = parsed.Success ?? parsed.success;
    if (success === false) {
      const msg = parsed.Message ?? parsed.message ?? "GetStockOnHandList returned an error";
      logger.warn("MICROS IM API returned success=false", {
        durationMs,
        message: msg.slice(0, 300),
        requestId: meta?.requestId,
      });
      return { ok: false, items: [], errorMessage: msg, durationMs };
    }

    const items = parsed.Data ?? parsed.data ?? [];

    logger.info("MICROS IM API call succeeded", {
      itemCount: items.length,
      durationMs,
      requestId: meta?.requestId,
      siteId: meta?.siteId,
    });

    return { ok: true, items, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const isAbort = err instanceof DOMException && err.name === "AbortError";
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
