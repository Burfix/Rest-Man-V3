/**
 * services/micros/MicrosSyncService.ts
 *
 * Orchestrates data sync from Oracle BIAPI → Supabase.
 * Uses getGuestChecks (the only enabled endpoint) to aggregate daily sales.
 */

import { createServerClient } from "@/lib/supabase/server";
import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { getMicrosConnection } from "@/services/micros/status";
import { aggregateGuestChecksToDailySales } from "./normalize";
import { todayISO } from "@/lib/utils";

export interface SyncResult {
  success:        boolean;
  message:        string;
  businessDate?:  string;
  recordsSynced?: number;
  errors?:        string[];
}

export class MicrosSyncService {
  /**
   * Fetches guest checks for the given date (default: today),
   * aggregates into daily sales, and upserts into Supabase.
   */
  async runFullSync(date?: string): Promise<SyncResult> {
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
      sync_type: "full",
      started_at: new Date().toISOString(),
      status: "running",
      records_fetched: 0,
      records_inserted: 0,
    });

    // Mark connection as syncing
    await supabase
      .from("micros_connections")
      .update({ status: "syncing" })
      .eq("id", connection.id);

    try {
      // Fetch guest checks from Oracle BIAPI
      const raw = await MicrosApiClient.post<{
        curUTC: string;
        locRef: string;
        guestChecks: unknown[] | null;
      }>("getGuestChecks", {
        busDt: businessDate,
        locRef: cfg.locRef,
      });

      const checkCount = raw.guestChecks?.length ?? 0;

      // Aggregate into daily totals
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const daily = aggregateGuestChecksToDailySales(raw as any, businessDate);

      if (!daily) {
        throw new Error("Failed to normalize guest checks data");
      }

      // Upsert into micros_sales_daily (unique on connection_id + loc_ref + business_date)
      const { error: upsertError } = await supabase
        .from("micros_sales_daily")
        .upsert(
          {
            connection_id: connection.id,
            loc_ref: daily.loc_ref || cfg.locRef,
            business_date: daily.business_date,
            net_sales: daily.net_sales,
            gross_sales: daily.gross_sales,
            tax_collected: daily.tax_collected,
            service_charges: daily.service_charges,
            discounts: daily.discounts,
            voids: daily.voids,
            returns: daily.returns,
            check_count: daily.check_count,
            guest_count: daily.guest_count,
            avg_check_value: daily.avg_check_value,
            avg_guest_spend: daily.avg_guest_spend,
            labor_cost: daily.labor_cost,
            labor_pct: daily.labor_pct,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "connection_id,loc_ref,business_date" },
        );

      if (upsertError) {
        throw new Error(`DB upsert failed: ${upsertError.message}`);
      }

      // Update sync run as success
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "success",
          records_fetched: checkCount,
          records_inserted: 1,
        })
        .eq("id", syncRunId);

      // Update connection status
      const now = new Date().toISOString();
      await supabase
        .from("micros_connections")
        .update({
          status: "connected",
          last_sync_at: now,
          last_successful_sync_at: now,
          last_sync_error: null,
        })
        .eq("id", connection.id);

      return {
        success: true,
        message: `Synced ${checkCount} guest checks → R${daily.net_sales.toLocaleString("en-ZA")} net sales, ${daily.guest_count} guests`,
        businessDate,
        recordsSynced: checkCount,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Log failure
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: errMsg.slice(0, 500),
        })
        .eq("id", syncRunId);

      await supabase
        .from("micros_connections")
        .update({
          status: "error",
          last_sync_at: new Date().toISOString(),
          last_sync_error: errMsg.slice(0, 500),
        })
        .eq("id", connection.id);

      return {
        success: false,
        message: errMsg,
        businessDate,
        errors: [errMsg],
      };
    }
  }
}
