/**
 * services/micros/inventory/client.ts
 *
 * Oracle MICROS BI API client functions for inventory endpoints.
 * Uses the existing authenticated MicrosApiClient (Bearer id_token).
 *
 * Endpoint: POST /bi/v1/{orgIdentifier}/getMenuItemInventoryCount
 * Per Oracle MICROS Inventory Management POS Web Services API Guide.
 */

import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import type { OracleInventoryCountResponse } from "./types";

export interface GetMenuItemInventoryCountParams {
  /** Business date in YYYY-MM-DD format (optional — defaults to current) */
  busDt?: string;
  /** Location reference (defaults to env MICROS_LOCATION_REF) */
  locRef?: string;
}

/**
 * POST /bi/v1/{orgIdentifier}/getMenuItemInventoryCount
 *
 * Retrieves current menu item inventory counts from Oracle MICROS.
 * Returns stock-on-hand for all tracked menu items at the specified location.
 */
export async function getMenuItemInventoryCount(
  params: GetMenuItemInventoryCountParams = {},
): Promise<OracleInventoryCountResponse> {
  const cfg = getMicrosEnvConfig();
  const locRef = params.locRef ?? cfg.locRef;

  const body: Record<string, string> = { locRef };
  if (params.busDt) body.busDt = params.busDt;

  return MicrosApiClient.post<OracleInventoryCountResponse>(
    "getMenuItemInventoryCount",
    body,
  );
}
