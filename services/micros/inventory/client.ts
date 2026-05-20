/**
 * services/micros/inventory/client.ts
 *
 * Oracle MICROS Inventory Management POS Web Services client.
 * Uses the standard RNA PKCE Bearer token (same as BI API).
 *
 * Endpoint: GET /im/v1/{orgShortName}/GetStockOnHandList
 * Per Oracle MICROS Inventory Management POS Web Services API Guide (E91248_07).
 *
 * NOTE: This is a thin wrapper for backward compatibility.
 * Prefer using services/micros/imClient.ts directly.
 */

import { fetchStockOnHand, getStockOnHandList as getStockOnHandListById } from "../imClient";
import type { StockOnHandListResult, OracleStockOnHand } from "./types";

export { MicrosAuthError } from "@/lib/micros/auth";

export interface GetStockOnHandListParams {
  /** Item identifier to filter by (optional — omit to get all items) */
  item?: number;
  /** Cost Center identifier to filter SOH entries by (optional) */
  costCenter?: number;
}

/**
 * GET GetStockOnHandList
 *
 * Returns Stock on Hand for all items (or a specific item/cost center).
 * Uses standard RNA PKCE Bearer auth (NOT separate IM credentials).
 */
export async function getStockOnHandList(
  params: GetStockOnHandListParams = {},
): Promise<StockOnHandListResult> {
  const result = await fetchStockOnHand(params);

  if (!result.ok) {
    return {
      Success: false,
      Message: result.errorMessage ?? "GetStockOnHandList failed",
      Data: [],
    };
  }

  return {
    Success: true,
    Data: result.items,
  };
}
