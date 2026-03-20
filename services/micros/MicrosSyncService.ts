/**
 * services/micros/MicrosSyncService.ts
 *
 * Sync orchestrator for Oracle MICROS BI live integration.
 *
 * Key design decisions:
 *  - Credentials come from env vars (not DB) — config loaded via getMicrosConfig()
 *  - A micros_connections row is upserted on each sync to track status
 *  - Sync runs are logged to micros_sync_runs for auditability
 *  - Non-critical data types (intervals, checks, labour) are try/catched
 *    so they never fail the primary daily-totals sync
 *  - All DB writes use upsert (idempotent — safe to re-run for same date)
 *  - MICROS_ENABLED=false returns a safe "disabled" result immediately
 */

import { createServerClient }     from "@/lib/supabase/server";
import { getMicrosConfig, isMicrosEnabled } from "@/lib/micros/config";
import { MicrosSalesService }     from "./MicrosSalesService";
import { MicrosLabourService }    from "./MicrosLabourService";
import { sanitizeMicrosError }    from "@/lib/integrations/status";
import type { MicrosSyncStatus, MicrosSyncType } from "@/types/micros";

// ── Result types ──────────────────────────────────────────────────────────

export interface SyncResult {
  success:         boolean;
  enabled:         boolean;
  syncRunId:       string | null;
  connectionId:    string | null;
  recordsFetched:  number;
  recordsInserted: number;
  error?:          string;
  /** Human-readable status for API consumers */
  message:         string;
}

interface SubSyncResult {
  fetched:  number;
  inserted: number;
}

// ── Service class ─────────────────────────────────────────────────────────

export class MicrosSyncService {
  private readonly salesService  = new MicrosSalesService();
  private readonly labourService = new MicrosLabourService();

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Synchronizes daily sales totals for the given store + date.
   * This is the primary / critical sync path.
   */
  async syncDailySales(locRef: string, date: string): Promise<SubSyncResult> {
    const supabase    = createServerClient();
    const connId      = await this.getOrCreateConnectionId();
    const { totals, raw } = await this.salesService.getDailySales(locRef, date);

    const { error } = await supabase
      .from("micros_sales_daily")
      .upsert(
        {
          connection_id:  connId,
          loc_ref:        locRef,
          business_date:  date,
          ...totals,
          synced_at:      new Date().toISOString(),
          raw_response:   raw as Record<string, unknown>,
        },
        { onConflict: "connection_id,loc_ref,business_date" },
      );

    if (error) throw new Error(`[MicrosSyncService] Daily sales upsert failed: ${error.message}`);

    return { fetched: 1, inserted: 1 };
  }

  /**
   * Synchronizes quarter-hour interval sales for the given store + date.
   * Non-critical — errors are reported but do not propagate.
   */
  async syncIntervalSales(locRef: string, date: string): Promise<SubSyncResult> {
    const supabase  = createServerClient();
    const connId    = await this.getOrCreateConnectionId();
    const intervals = await this.salesService.getIntervalSales(locRef, date);

    if (intervals.length === 0) return { fetched: 0, inserted: 0 };

    const rows = intervals.map((iv) => ({
      connection_id:  connId,
      loc_ref:        locRef,
      business_date:  date,
      ...iv,
      synced_at:      new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("micros_sales_intervals")
      .upsert(rows, { onConflict: "connection_id,loc_ref,business_date,interval_start" });

    if (error) throw new Error(`[MicrosSyncService] Interval upsert failed: ${error.message}`);

    return { fetched: intervals.length, inserted: rows.length };
  }

  /**
   * Synchronizes labour timecard records for the given store + date.
   * Non-critical — errors are reported but do not propagate.
   */
  async syncLabour(locRef: string, date: string): Promise<SubSyncResult> {
    const supabase    = createServerClient();
    const connId      = await this.getOrCreateConnectionId();
    const laborRows   = await this.labourService.getLabourByJob(locRef, date);

    if (laborRows.length === 0) return { fetched: 0, inserted: 0 };

    const rows = laborRows.map((lr) => ({
      connection_id:  connId,
      loc_ref:        locRef,
      business_date:  date,
      ...lr,
      synced_at:      new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("micros_labor_daily")
      .upsert(rows, { onConflict: "connection_id,loc_ref,business_date,job_code" });

    if (error) throw new Error(`[MicrosSyncService] Labour upsert failed: ${error.message}`);

    return { fetched: laborRows.length, inserted: rows.length };
  }

  /**
   * Runs a complete sync for all data types for the given date.
   *
   * Sequence:
   *  1. Guard: return immediately if MICROS_ENABLED=false
   *  2. Load env-var config (throws if required vars missing)
   *  3. Upsert / create micros_connections row for status tracking
   *  4. Open sync run audit record
   *  5. Sync daily totals (critical — fails whole run on error)
   *  6. Sync intervals, guest checks, labour (non-critical — soft errors)
   *  7. Close sync run with final counts
   *  8. Update connection status
   */
  async runFullSync(date?: string): Promise<SyncResult> {
    // ── Guard ──────────────────────────────────────────────────────────────
    if (!isMicrosEnabled()) {
      return {
        success:         false,
        enabled:         false,
        syncRunId:       null,
        connectionId:    null,
        recordsFetched:  0,
        recordsInserted: 0,
        message:         "MICROS integration is disabled. Set MICROS_ENABLED=true to activate.",
      };
    }

    const supabase      = createServerClient();
    const cfg           = getMicrosConfig(); // throws if env vars missing
    const businessDate  = date ?? todayJHB();
    const locRef        = cfg.locRef;

    let connectionId    = "";
    let syncRunId       = "";
    let totalFetched    = 0;
    let totalInserted   = 0;

    // ── Mark connection as syncing ─────────────────────────────────────────
    connectionId = await this.getOrCreateConnectionId();

    await supabase
      .from("micros_connections")
      .update({ status: "syncing", last_sync_at: new Date().toISOString() })
      .eq("id", connectionId);

    // ── Open sync run ──────────────────────────────────────────────────────
    syncRunId = await this.openSyncRun(connectionId, "full");

    try {
      // ── 1. Daily totals (critical) ─────────────────────────────────────
      const dailyResult = await this.syncDailySales(locRef, businessDate);
      totalFetched  += dailyResult.fetched;
      totalInserted += dailyResult.inserted;

      // ── 2. Intervals (non-critical) ────────────────────────────────────
      try {
        const iv = await this.syncIntervalSales(locRef, businessDate);
        totalFetched  += iv.fetched;
        totalInserted += iv.inserted;
      } catch (err) {
        console.warn("[MicrosSyncService] Interval sync skipped:", safeMessage(err));
      }

      // ── 3. Guest checks (non-critical) ─────────────────────────────────
      try {
        const checks = await this.syncGuestChecks(locRef, businessDate, connectionId);
        totalFetched  += checks.fetched;
        totalInserted += checks.inserted;
      } catch (err) {
        console.warn("[MicrosSyncService] Guest check sync skipped:", safeMessage(err));
      }

      // ── 4. Labour (non-critical) ───────────────────────────────────────
      try {
        const lab = await this.syncLabour(locRef, businessDate);
        totalFetched  += lab.fetched;
        totalInserted += lab.inserted;
      } catch (err) {
        console.warn("[MicrosSyncService] Labour sync skipped:", safeMessage(err));
      }

      // ── Finalise success ───────────────────────────────────────────────
      const now = new Date().toISOString();
      await Promise.all([
        this.closeSyncRun(syncRunId, "success", totalFetched, totalInserted, null),
        supabase
          .from("micros_connections")
          .update({
            status:                  "connected",
            last_sync_at:            now,
            last_successful_sync_at: now,
            last_sync_error:         null,
          })
          .eq("id", connectionId),
      ]);

      return {
        success:         true,
        enabled:         true,
        syncRunId,
        connectionId,
        recordsFetched:  totalFetched,
        recordsInserted: totalInserted,
        message:         `Sync completed. ${totalInserted} records written for ${businessDate}.`,
      };

    } catch (err) {
      const rawMessage  = safeMessage(err);
      const message     = sanitizeMicrosError(rawMessage);
      const now         = new Date().toISOString();

      await Promise.all([
        this.closeSyncRun(syncRunId, "error", totalFetched, totalInserted, message),
        supabase
          .from("micros_connections")
          .update({
            status:          "error",
            last_sync_at:    now,
            last_sync_error: message,
          })
          .eq("id", connectionId),
      ]);

      console.error("[MicrosSyncService] Full sync failed:", message);

      return {
        success:         false,
        enabled:         true,
        syncRunId,
        connectionId,
        recordsFetched:  totalFetched,
        recordsInserted: totalInserted,
        error:           message,
        message:         `Sync failed: ${message}`,
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Finds or creates the micros_connections row keyed by loc_ref.
   * Upserts env-var config into the row (excluding credentials).
   * Returns the row id.
   */
  private connectionIdCache: string | null = null;

  async getOrCreateConnectionId(): Promise<string> {
    if (this.connectionIdCache) return this.connectionIdCache;

    const supabase = createServerClient();
    const cfg      = getMicrosConfig();

    // Try to find existing row by loc_ref
    const { data: existing } = await supabase
      .from("micros_connections")
      .select("id")
      .eq("loc_ref", cfg.locRef)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      this.connectionIdCache = existing.id as string;
      return existing.id as string;
    }

    // Create a new row seeded from env vars (no credentials stored)
    const { data: created, error } = await supabase
      .from("micros_connections")
      .insert({
        location_name:   cfg.apiAccountName || "Pilot Store",
        loc_ref:         cfg.locRef,
        auth_server_url: cfg.authServer,
        app_server_url:  cfg.appServer,
        client_id:       cfg.clientId,
        org_identifier:  cfg.orgIdentifier,
        api_account_name: cfg.apiAccountName,
        status:          "awaiting_setup",
      })
      .select("id")
      .single();

    if (error || !created?.id) {
      throw new Error(`[MicrosSyncService] Failed to create connection row: ${error?.message ?? "unknown"}`);
    }

    this.connectionIdCache = created.id as string;
    return created.id as string;
  }

  private async openSyncRun(
    connectionId: string,
    syncType:     MicrosSyncType,
  ): Promise<string> {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("micros_sync_runs")
      .insert({
        connection_id: connectionId,
        sync_type:     syncType,
        status:        "running",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.warn("[MicrosSyncService] Failed to create sync run audit record:", error?.message);
      return "";
    }
    return data.id as string;
  }

  private async closeSyncRun(
    runId:    string,
    status:   MicrosSyncStatus,
    fetched:  number,
    inserted: number,
    error:    string | null,
  ): Promise<void> {
    if (!runId) return;
    const supabase = createServerClient();
    await supabase
      .from("micros_sync_runs")
      .update({
        status,
        completed_at:     new Date().toISOString(),
        records_fetched:  fetched,
        records_inserted: inserted,
        error_message:    error,
      })
      .eq("id", runId);
  }

  /**
   * Guest check sync — uses the sales service but needs the connectionId
   * explicitly because of direct Supabase write pattern.
   */
  private async syncGuestChecks(
    locRef:       string,
    date:         string,
    connectionId: string,
  ): Promise<SubSyncResult> {
    const supabase = createServerClient();
    const checks   = await this.salesService.getGuestChecks(locRef, date);

    if (checks.length === 0) return { fetched: 0, inserted: 0 };

    const rows = checks.map((c) => ({
      connection_id:  connectionId,
      loc_ref:        locRef,
      business_date:  date,
      ...c,
      synced_at:      new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("micros_guest_checks")
      .upsert(rows, { onConflict: "connection_id,loc_ref,check_number,business_date" });

    if (error) throw new Error(`[MicrosSyncService] Guest check upsert failed: ${error.message}`);

    return { fetched: checks.length, inserted: rows.length };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}
