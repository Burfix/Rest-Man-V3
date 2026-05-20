/**
 * lib/sync/adapters/micros-sales.adapter.ts
 *
 * Source adapter for MICROS Oracle BIAPI sales data.
 * Implements the SourceAdapter contract for the Sync Engine V2.
 *
 * Reuses existing auth, client, and normalizer layers.
 */

import { createServerClient } from "@/lib/supabase/server";
import { MicrosApiClient } from "@/lib/micros/client";
import { getMicrosEnvConfig, isMicrosEnabled } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { aggregateGuestChecksToDailySales } from "@/services/micros/normalize";
import { logger } from "@/lib/logger";
import type {
  SourceAdapter,
  SyncConfig,
  SyncCheckpoint,
  RawRecord,
  NormalizedRecord,
  WriteResult,
} from "../types";

// ── Raw record shape ────────────────────────────────────────────────────

interface MicrosSalesRawRecord extends RawRecord {
  data: {
    curUTC: string;
    locRef: string;
    guestChecks: unknown[];
    businessDate: string;
    connectionId: string;
  };
}

// ── Adapter ─────────────────────────────────────────────────────────────

export const microsSalesAdapter: SourceAdapter<MicrosSalesRawRecord> = {
  /**
   * Phase 1: Validate MICROS is enabled + a connected connection exists.
   */
  async validate(config: SyncConfig): Promise<void> {
    if (!isMicrosEnabled()) {
      throw new Error("MICROS integration is disabled (MICROS_ENABLED != true)");
    }

    const cfg = getMicrosEnvConfig();
    if (!cfg.locRef) {
      throw new Error("MICROS_LOCATION_REF is not configured");
    }

    const supabase = createServerClient();
    const { data: conn } = await supabase
      .from("micros_connections")
      .select("id, loc_ref, status")
      .eq("loc_ref", cfg.locRef)
      .eq("status", "connected")
      .maybeSingle();

    if (!conn) {
      throw new Error(
        `No active MICROS connection found for loc_ref ${cfg.locRef}. ` +
        `Check the micros_connections table and ensure status='connected'.`,
      );
    }

    logger.info("[adapter:micros-sales] Validate OK", {
      siteId: config.siteId,
      connectionId: conn.id,
      locRef: conn.loc_ref,
    });
  },

  /**
   * Phase 5: Fetch guest checks from Oracle BIAPI.
   */
  async fetch(config: SyncConfig, _checkpoint?: SyncCheckpoint): Promise<MicrosSalesRawRecord[]> {
    const businessDate = config.businessDate!;
    const cfg = getMicrosEnvConfig();
    const supabase = createServerClient();

    // Resolve connection by loc_ref (deterministic — safe for multi-site future)
    const { data: connection } = await supabase
      .from("micros_connections")
      .select("id, loc_ref, access_token, token_expires_at")
      .eq("loc_ref", cfg.locRef)
      .eq("status", "connected")
      .maybeSingle();

    if (!connection) {
      throw new Error("No MICROS connection found");
    }

    // Cast to access refresh_token (column may not exist pre-migration-040)
    const connRow = connection as typeof connection & { refresh_token?: string };

    // Seed token cache from DB for cold-start resilience
    if (connection.access_token && connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at).getTime();
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(
          connection.access_token,
          expiresAt,
          connRow.refresh_token,
        );
      }
    }

    // Fetch guest checks
    const raw = await MicrosApiClient.post<{
      curUTC: string;
      locRef: string;
      guestChecks: unknown[] | null;
    }>("getGuestChecks", {
      busDt: businessDate,
      locRef: connection.loc_ref ?? cfg.locRef,
    });

    if (!raw || typeof raw !== "object") {
      throw new Error(`Oracle returned invalid response: ${typeof raw}`);
    }

    const checks = raw.guestChecks ?? [];

    logger.info("[adapter:micros-sales] Fetched guest checks", {
      businessDate,
      count: checks.length,
      locRef: raw.locRef,
    });

    // Persist token to DB after successful fetch
    const tokenInfo = getCachedMicrosToken();
    if (tokenInfo) {
      const tokenUpdate: Record<string, unknown> = {
        access_token: tokenInfo.idToken,
        token_expires_at: new Date(tokenInfo.expiresAt).toISOString(),
        status: "connected",
        last_sync_at: new Date().toISOString(),
      };
      if (tokenInfo.refreshToken) {
        tokenUpdate.refresh_token = tokenInfo.refreshToken;
      }
      await supabase
        .from("micros_connections")
        .update(tokenUpdate)
        .eq("id", connection.id)
        .then(null, () => {}); // best-effort
    }

    // Return as a single raw record (daily aggregate)
    return [
      {
        key: `sales:${businessDate}`,
        data: {
          curUTC: raw.curUTC,
          locRef: raw.locRef,
          guestChecks: checks,
          businessDate,
          connectionId: connection.id,
        },
      },
    ];
  },

  /**
   * Phase 6: Normalize raw guest checks → daily sales totals.
   */
  normalize(raw: MicrosSalesRawRecord[]): NormalizedRecord[] {
    const results: NormalizedRecord[] = [];

    for (const record of raw) {
      const oracleResponse = {
        curUTC: record.data.curUTC,
        locRef: record.data.locRef,
        guestChecks: record.data.guestChecks as null | unknown[],
      };

      const daily = aggregateGuestChecksToDailySales(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oracleResponse as any,
        record.data.businessDate,
      );

      if (!daily) continue;

      // Compute hash synchronously is not possible with crypto.subtle,
      // so we'll do it with a simple deterministic string hash for the sync path
      const hashInput = JSON.stringify(daily, Object.keys(daily).sort());
      const simpleHash = simpleStringHash(hashInput);

      results.push({
        key: record.key,
        contentHash: simpleHash,
        data: {
          ...daily,
          connection_id: record.data.connectionId,
        },
      });
    }

    return results;
  },

  /**
   * Phase 8: Write normalized sales to micros_sales_daily (upsert).
   */
  async write(
    records: NormalizedRecord[],
    _config: SyncConfig,
    _runId: string,
  ): Promise<WriteResult[]> {
    const supabase = createServerClient();
    const results: WriteResult[] = [];

    for (const record of records) {
      const d = record.data;
      try {
        const { error } = await supabase
          .from("micros_sales_daily")
          .upsert(
            {
              connection_id: d.connection_id as string,
              loc_ref: d.loc_ref as string,
              business_date: d.business_date as string,
              net_sales: d.net_sales as number,
              gross_sales: d.gross_sales as number,
              tax_collected: d.tax_collected as number,
              service_charges: d.service_charges as number,
              discounts: d.discounts as number,
              voids: d.voids as number,
              returns: d.returns as number,
              check_count: d.check_count as number,
              guest_count: d.guest_count as number,
              avg_check_value: d.avg_check_value as number,
              avg_guest_spend: d.avg_guest_spend as number,
              labor_cost: d.labor_cost as number,
              labor_pct: d.labor_pct as number,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "connection_id,loc_ref,business_date" },
          );

        if (error) {
          results.push({ key: record.key, written: false, skipped: false, error: error.message });
        } else {
          results.push({ key: record.key, written: true, skipped: false });
        }
      } catch (err) {
        results.push({
          key: record.key,
          written: false,
          skipped: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  },

  /**
   * Phase 9: Checkpoint value = the business date we just synced.
   */
  getCheckpointValue(config: SyncConfig, _records: NormalizedRecord[]): string {
    return config.businessDate!;
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Simple deterministic string hash (djb2 variant) for synchronous use.
 * Not cryptographic — used for content comparison only.
 */
function simpleStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
