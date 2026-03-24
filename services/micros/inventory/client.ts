/**
 * services/micros/inventory/client.ts
 *
 * Oracle MICROS Inventory Management POS Web Services client.
 * Uses the existing authenticated MicrosApiClient (Bearer id_token).
 *
 * Endpoint: POST GetStockOnHandList
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 *
 * The Inventory Management POS WS API may be served at a different base path
 * from the BI API. Set MICROS_IM_API_PATH (default: "/im/v1") if the IM API
 * uses a different path prefix than /bi/v1.
 */

import { getMicrosIdToken, MicrosAuthError } from "@/lib/micros/auth";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import type { StockOnHandListResult } from "./types";

export { MicrosAuthError } from "@/lib/micros/auth";

const REQUEST_TIMEOUT_MS = 30_000;

export interface GetStockOnHandListParams {
  /** Item identifier to filter by (optional — omit to get all items) */
  item?: number;
  /** Cost Center identifier to filter SOH entries by (optional) */
  costCenter?: number;
}

/**
 * Builds the base URL for Inventory Management API calls.
 * Tries, in order:
 *   1. MICROS_IM_SERVER env var (dedicated IM server)
 *   2. MICROS_BI_SERVER (same server, different path)
 * Path prefix defaults to "/im/v1" but can be overridden via MICROS_IM_API_PATH.
 */
function getImBaseUrl(): string {
  const cfg = getMicrosEnvConfig();
  const server =
    (process.env.MICROS_IM_SERVER ?? "").replace(/\/$/, "") || cfg.appServer;
  if (!server || !cfg.orgIdentifier) {
    throw new MicrosAuthError(
      "config",
      "MICROS server or MICROS_ORG_SHORT_NAME is not configured.",
    );
  }
  const apiPath =
    (process.env.MICROS_IM_API_PATH ?? "").replace(/\/$/, "") || "/bi/v1";
  return `${server}${apiPath}/${cfg.orgIdentifier}`;
}

/**
 * POST GetStockOnHandList
 *
 * Returns Stock on Hand for all items (or a specific item/cost center).
 * Per Table 6 in the Oracle IM POS Web Services API Guide.
 */
export async function getStockOnHandList(
  params: GetStockOnHandListParams = {},
): Promise<StockOnHandListResult> {
  const idToken = await getMicrosIdToken();
  const baseUrl = getImBaseUrl();
  const url = `${baseUrl}/GetStockOnHandList`;

  const body: Record<string, unknown> = {};
  if (params.item !== undefined) body.item = params.item;
  if (params.costCenter !== undefined) body.costCenter = params.costCenter;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      throw new MicrosAuthError(
        "token",
        `IM API POST GetStockOnHandList failed (HTTP ${res.status}).`,
        text.slice(0, 500),
        res.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
      );
    }

    try {
      return JSON.parse(text) as StockOnHandListResult;
    } catch {
      throw new MicrosAuthError(
        "token",
        "GetStockOnHandList returned non-JSON response.",
        text.slice(0, 300),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}
