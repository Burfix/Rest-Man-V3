/**
 * services/micros/inventory/sync.ts
 *
 * Orchestrates inventory sync from Oracle MICROS → Supabase inventory_items.
 *
 * NOTE: The Oracle Inventory Management module (getMenuItemInventoryCount) is NOT
 * available on the BIAPI. The BI API only supports: getGuestChecks,
 * getTimeCardDetails, getJobCodeDimensions. This sync returns early until the
 * Inventory Management module is provisioned on this tenant.
 */

import { createServerClient } from "@/lib/supabase/server";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosConnection } from "@/services/micros/status";
import { todayISO } from "@/lib/utils";
import type { InventorySyncResult } from "./types";

// ── Public sync function ────────────────────────────────────────────────────

export async function syncInventoryFromMicros(
  date?: string,
): Promise<InventorySyncResult> {
  const businessDate = date ?? todayISO();
  const cfg = getMicrosEnvConfig();
  const connection = await getMicrosConnection();

  if (!connection) {
    return { success: false, message: "No MICROS connection configured." };
  }

  const supabase = createServerClient();
  const syncRunId = crypto.randomUUID();

  // Log sync start
  await supabase.from("micros_sync_runs").insert({
    id: syncRunId,
    connection_id: connection.id,
    sync_type: "inventory",
    started_at: new Date().toISOString(),
    status: "running",
    records_fetched: 0,
    records_inserted: 0,
  });

  try {
    // ── DISABLED: getMenuItemInventoryCount does not exist on the BIAPI ──
    // The Oracle Inventory Management module is separate from the BI API.
    // The BI API only supports: getGuestChecks, getTimeCardDetails, getJobCodeDimensions.
    // Until the Inventory Management module is provisioned, this sync cannot run.
    await supabase
      .from("micros_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "skipped",
        error_message: "getMenuItemInventoryCount is not available on the BIAPI. Inventory Management module not provisioned.",
      })
      .eq("id", syncRunId);

    return {
      success: false,
      message:
        "Inventory sync unavailable — the Oracle Inventory Management module is not provisioned on this BIAPI tenant. Stock data is managed locally.",
      businessDate,
      itemsSynced: 0,
    };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("micros_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "error",
        error_message: errMsg.slice(0, 500),
      })
      .eq("id", syncRunId);

    return {
      success: false,
      message: errMsg,
      businessDate,
      errors: [errMsg],
    };
  }
}
