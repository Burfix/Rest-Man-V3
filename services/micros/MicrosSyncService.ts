/**
 * services/micros/MicrosSyncService.ts
 *
 * Orchestrates data sync from Oracle BIAPI → Supabase.
 * Uses getGuestChecks (the only enabled endpoint) to aggregate daily sales.
 *
 * Resilience features:
 *   - Token seeding with refreshToken for fast cold-start auth
 *   - Zombie sync-run cleanup (stale "running" entries)
 *   - Structured logging at every stage
 *   - Defensive error handling with full context
 */

import { createServerClient } from "@/lib/supabase/server";
import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { getMicrosConnectionBySiteId } from "@/services/micros/status";
import { aggregateGuestChecksToDailySales } from "./normalize";
import { todayISO } from "@/lib/utils";
import { logger } from "@/lib/logger";

/** Max age (ms) for a sync run to stay in "running" before it's declared a zombie. */
const ZOMBIE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface SyncResult {
  success:        boolean;
  message:        string;
  businessDate?:  string;
  recordsSynced?: number;
  errors?:        string[];
}

/**
 * Required tenant context for every MICROS sync operation.
 * All three fields must be non-empty — the sync engine will throw if any are missing.
 */
export interface MicrosSyncContext {
  /** Supabase site UUID (e.g. "00000000-0000-0000-0000-000000000002"). Required. */
  siteId: string;
  /** Supabase organisation UUID. Required. */
  organisationId: string;
  /** Oracle MICROS location reference (e.g. "2001002"). Required. Validated against DB. */
  microsLocationRef: string;
}

export class MicrosSyncService {
  /**
   * Fetches guest checks for the given date (default: today),
   * aggregates into daily sales, and upserts into Supabase.
   *
   * @param context - REQUIRED tenant context. Fails closed if any field missing.
   * @param date    - Business date (YYYY-MM-DD). Defaults to today.
   */
  async runFullSync(context: MicrosSyncContext, date?: string): Promise<SyncResult> {
    // ── Tenant context validation (fail closed) ───────────────────────────
    const { siteId, organisationId, microsLocationRef } = context;
    if (!siteId)            throw new Error("[MicrosSyncService] siteId is required — never run globally");
    if (!organisationId)    throw new Error("[MicrosSyncService] organisationId is required");
    if (!microsLocationRef) throw new Error("[MicrosSyncService] microsLocationRef is required");
    const businessDate = date ?? todayISO();
    const t0 = Date.now();
    const cfg = getMicrosEnvConfig();

    // ── Tenant-scoped connection lookup ───────────────────────────────────
    const connection = await getMicrosConnectionBySiteId(siteId);
    if (!connection) {
      return { success: false, message: `No MICROS connection configured for site ${siteId}.` };
    }

    // ── Cross-check: requested locRef must match DB record ────────────────
    if (connection.loc_ref && connection.loc_ref !== microsLocationRef) {
      const msg = `[MicrosSyncService] SECURITY: microsLocationRef mismatch. ` +
        `Requested=${microsLocationRef}, DB=${connection.loc_ref}, siteId=${siteId}`;
      logger.error(msg);
      throw new Error(msg);
    }

    // ── Resolve effective locRef for sales (getGuestChecks) ──────────────
    // sales_location_ref overrides loc_ref when Oracle uses a different
    // revenue-centre hierarchy (e.g. Primi Camps Bay: labour=101003, sales=different).
    const effectiveLocRef = (connection as { sales_location_ref?: string | null }).sales_location_ref?.trim()
      || microsLocationRef;

    const supabase = createServerClient();

    // ── Clean up zombie sync runs scoped to this connection ──────────────
    try {
      const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS).toISOString();
      const { data: zombies } = await supabase
        .from("micros_sync_runs")
        .update({
          status: "error",
          completed_at: new Date().toISOString(),
          error_message: "Sync run timed out (zombie cleanup)",
        })
        .eq("status", "running")
        .eq("connection_id", connection.id)    // TENANT SCOPE
        .lt("started_at", cutoff)
        .select("id");
      if (zombies && zombies.length > 0) {
        logger.warn("Cleaned up zombie sync runs", {
          count: zombies.length,
          ids: zombies.map((z) => z.id),
        });
      }
    } catch (err) {
      logger.warn("Zombie cleanup failed (non-fatal)", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Seed in-memory token cache from DB (survives cold-starts) ───────
    try {
      const { data: tokenRow } = await supabase
        .from("micros_connections")
        .select("access_token, token_expires_at")
        .eq("id", connection.id)
        .maybeSingle();

      // refresh_token column may exist in DB but not in generated types — use a separate query
      let refreshToken: string | undefined;
      try {
        const { data: rtRow } = await supabase
          .from("micros_connections")
          .select()
          .eq("id", connection.id)
          .maybeSingle();
        refreshToken = (rtRow as Record<string, unknown> | null)?.refresh_token as string | undefined;
      } catch {
        // Column might not exist pre-migration — ignore
      }

      if (tokenRow?.access_token && tokenRow?.token_expires_at) {
        const expiresAt = new Date(tokenRow.token_expires_at).getTime();
        if (expiresAt > Date.now()) {
          seedMicrosTokenCache(
            tokenRow.access_token,
            expiresAt,
            refreshToken,
          );
          logger.info("Token seeded from DB", {
            expiresIn: Math.round((expiresAt - Date.now()) / 3600_000) + "h",
            hasRefresh: !!refreshToken,
          });
        } else {
          logger.info("DB token expired, will re-authenticate via PKCE");
        }
      }
    } catch (err) {
      // Non-fatal — will fall back to full PKCE auth
      // The refresh_token column might not exist yet (pre-migration)
      logger.warn("Token seed from DB failed (non-fatal)", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

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
      logger.info("[MicrosSyncService] Calling getGuestChecks", {
        siteId,
        labourLocRef:      microsLocationRef,
        salesLocRef:       effectiveLocRef,
        usingSalesOverride: effectiveLocRef !== microsLocationRef,
        businessDate,
        orgIdentifier:    cfg.orgIdentifier,
        endpoint:         `${cfg.appServer}/bi/v1/${cfg.orgIdentifier}/getGuestChecks`,
      });
      let raw: { curUTC: string; locRef: string; guestChecks: unknown[] | null };
      try {
        raw = await MicrosApiClient.post<{
          curUTC: string;
          locRef: string;
          guestChecks: unknown[] | null;
        }>("getGuestChecks", {
          busDt: businessDate,
          locRef: effectiveLocRef,
        });
      } catch (apiErr) {
        // Log full Oracle error context to help diagnose wrong locRef
        const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        logger.error("[MicrosSyncService] Oracle getGuestChecks failed", {
          siteId,
          salesLocRef:       effectiveLocRef,
          labourLocRef:      microsLocationRef,
          usingSalesOverride: effectiveLocRef !== microsLocationRef,
          orgIdentifier:     cfg.orgIdentifier,
          businessDate,
          endpoint:          `${cfg.appServer}/bi/v1/${cfg.orgIdentifier}/getGuestChecks`,
          oracleError:       errMsg,
          hint: effectiveLocRef === microsLocationRef
            ? `loc_ref=${effectiveLocRef} rejected. Set sales_location_ref on the connection row to the correct Oracle revenue-centre enterprise location ID.`
            : `sales_location_ref=${effectiveLocRef} rejected. Check Oracle BI admin for the correct revenue-centre location ID.`,
        });
        throw apiErr;
      }

      const checkCount = raw?.guestChecks?.length ?? 0;
      logger.info("Guest checks received", { checkCount, businessDate });

      // Guard against null/undefined response
      if (!raw || typeof raw !== "object") {
        throw new Error(
          `Oracle returned invalid response: ${typeof raw}. Expected object with guestChecks array.`,
        );
      }

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
            site_id:        siteId,                              // TENANT TAG — required
            loc_ref: daily.loc_ref || effectiveLocRef,
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

      const elapsed = Date.now() - t0;

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

      // Update connection status + persist token for cold-start resilience
      const now = new Date().toISOString();
      const tokenInfo = getCachedMicrosToken();
      const tokenUpdate: Record<string, unknown> = {
        status: "connected",
        last_sync_at: now,
        last_successful_sync_at: now,
        last_sync_error: null,
      };
      if (tokenInfo) {
        tokenUpdate.access_token = tokenInfo.idToken;
        tokenUpdate.token_expires_at = new Date(tokenInfo.expiresAt).toISOString();
        // Persist refresh token if available (column may not exist pre-migration)
        if (tokenInfo.refreshToken) {
          tokenUpdate.refresh_token = tokenInfo.refreshToken;
        }
      }
      // Use a try for the token persist — refresh_token column may not exist yet
      try {
        await supabase
          .from("micros_connections")
          .update(tokenUpdate)
          .eq("id", connection.id);
      } catch {
        // If refresh_token column doesn't exist, retry without it
        delete tokenUpdate.refresh_token;
        await supabase
          .from("micros_connections")
          .update(tokenUpdate)
          .eq("id", connection.id);
      }

      logger.info("MICROS sales sync completed", {
        businessDate,
        checkCount,
        netSales: daily.net_sales,
        elapsed: `${elapsed}ms`,
      });

      return {
        success: true,
        message: `Synced ${checkCount} guest checks → R${daily.net_sales.toLocaleString("en-ZA")} net sales, ${daily.guest_count} guests`,
        businessDate,
        recordsSynced: checkCount,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const elapsed = Date.now() - t0;

      logger.error("MICROS sales sync failed", {
        businessDate,
        siteId,
        microsLocationRef,
        elapsed: `${elapsed}ms`,
        error: errMsg,
        errorName: err instanceof Error ? err.name : "unknown",
        stage: "runFullSync",
      });

      // Log failure to DB
      await supabase
        .from("micros_sync_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error_message: errMsg.slice(0, 500),
        })
        .eq("id", syncRunId)
        .then(null, () => {}); // swallow DB write error — we're already in error path

      await supabase
        .from("micros_connections")
        .update({
          status: "error",
          last_sync_at: new Date().toISOString(),
          last_sync_error: errMsg.slice(0, 500),
        })
        .eq("id", connection.id)
        .then(null, () => {});

      return {
        success: false,
        message: errMsg,
        businessDate,
        errors: [errMsg],
      };
    }
  }
}
