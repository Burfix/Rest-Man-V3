/**
 * lib/sync/adapters/micros-inventory.adapter.ts
 *
 * Source adapter for MICROS Oracle IM inventory data (GetStockOnHandList).
 * Implements the SourceAdapter contract for the Sync Engine V2.
 *
 * Auth: Standard RNA PKCE Bearer token (same as BI API — no separate IM user).
 */

import { createServerClient } from "@/lib/supabase/server";
import { isMicrosEnabled, getMicrosEnvConfig } from "@/lib/micros/config";
import { seedMicrosTokenCache, getCachedMicrosToken } from "@/lib/micros/auth";
import { fetchAllStockOnHand } from "@/services/micros/imClient";
import type { OracleStockOnHand } from "@/services/micros/inventory/types";
import { logger } from "@/lib/logger";
import type {
  SourceAdapter,
  SyncConfig,
  SyncCheckpoint,
  RawRecord,
  NormalizedRecord,
  WriteResult,
} from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Raw record shape ────────────────────────────────────────────────────

interface InventoryRawRecord extends RawRecord {
  data: {
    items: OracleStockOnHand[];
    fetchedAt: string;
    durationMs: number;
  };
}

// ── Simple hash utility ─────────────────────────────────────────────────

function simpleStringHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `inv-${Math.abs(hash).toString(36)}`;
}

// ── Adapter ─────────────────────────────────────────────────────────────

export const microsInventoryAdapter: SourceAdapter<InventoryRawRecord> = {
  /**
   * Phase 1: Validate MICROS is enabled + a connected connection exists.
   */
  async validate(config: SyncConfig): Promise<void> {
    if (!isMicrosEnabled()) {
      throw new Error("MICROS integration is disabled (MICROS_ENABLED != true)");
    }

    const cfg = getMicrosEnvConfig();
    if (!cfg.orgIdentifier) {
      throw new Error("MICROS_ORG_SHORT_NAME is not configured");
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
        `No active MICROS connection for loc_ref ${cfg.locRef}.`,
      );
    }

    logger.info("[adapter:micros-inventory] Validate OK", {
      siteId: config.siteId,
      connectionId: conn.id,
      locRef: conn.loc_ref,
    });
  },

  /**
   * Phase 5: Fetch stock-on-hand from Oracle IM API.
   */
  async fetch(config: SyncConfig, _checkpoint?: SyncCheckpoint): Promise<InventoryRawRecord[]> {
    const cfg = getMicrosEnvConfig();
    const supabase = createServerClient();

    // Resolve connection
    const { data: connection } = await supabase
      .from("micros_connections")
      .select("id, loc_ref, access_token, token_expires_at")
      .eq("loc_ref", cfg.locRef)
      .eq("status", "connected")
      .maybeSingle();

    if (!connection) {
      throw new Error("No MICROS connection found");
    }

    const connRow = connection as typeof connection & { refresh_token?: string };

    // Seed token cache from DB
    if (connection.access_token && connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at).getTime();
      if (expiresAt > Date.now()) {
        seedMicrosTokenCache(connection.access_token, expiresAt, connRow.refresh_token);
      }
    }

    // Call IM API
    const result = await fetchAllStockOnHand({
      requestId: config.idempotencyKey ?? crypto.randomUUID(),
      siteId: config.siteId,
    });

    if (!result.ok) {
      throw new Error(`IM API failed: ${result.errorMessage}`);
    }

    logger.info("[adapter:micros-inventory] Fetched stock on hand", {
      itemCount: result.items.length,
      durationMs: result.durationMs,
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
      if (tokenInfo.refreshToken) tokenUpdate.refresh_token = tokenInfo.refreshToken;
      await supabase
        .from("micros_connections")
        .update(tokenUpdate)
        .eq("id", connection.id)
        .then(null, () => {});
    }

    return [
      {
        key: `inventory:${config.businessDate ?? new Date().toISOString().slice(0, 10)}`,
        data: {
          items: result.items,
          fetchedAt: new Date().toISOString(),
          durationMs: result.durationMs,
        },
      },
    ];
  },

  /**
   * Phase 6: Normalize Oracle StockOnHand items.
   */
  normalize(raw: InventoryRawRecord[]): NormalizedRecord[] {
    const results: NormalizedRecord[] = [];

    for (const record of raw) {
      for (const soh of record.data.items) {
        const itemNumber = soh.ItemNumber ?? soh.itemNumber ?? 0;
        const itemName = soh.Item ?? soh.item ?? `Item ${itemNumber}`;
        const qty = soh.Qty ?? soh.qty;
        const costCenter = soh.CostCenter ?? soh.costCenter;

        const normalized = {
          micros_item_id: String(itemNumber),
          name: itemName,
          current_stock: qty?.Value ?? qty?.value ?? 0,
          unit: qty?.Unit ?? qty?.unit ?? "ea",
          category: costCenter?.Name ?? costCenter?.name ?? "Uncategorised",
          cost_center_id: costCenter?.ID ?? costCenter?.id ?? null,
          cost_center_name: costCenter?.Name ?? costCenter?.name ?? null,
        };

        const hashInput = JSON.stringify(normalized, Object.keys(normalized).sort());

        results.push({
          key: `soh:${itemNumber}:${costCenter?.ID ?? costCenter?.id ?? 'all'}`,
          contentHash: simpleStringHash(hashInput),
          data: normalized,
        });
      }
    }

    return results;
  },

  /**
   * Phase 8: Write normalized inventory data to DB.
   */
  async write(
    records: NormalizedRecord[],
    config: SyncConfig,
    _runId: string,
  ): Promise<WriteResult[]> {
    const supabase = createServerClient();
    const results: WriteResult[] = [];
    const siteId = config.siteId;

    // Batch: collect all micros_item_ids
    const microsIds = records.map((r) => String(r.data.micros_item_id));
    const { data: existing } = await (supabase as any)
      .from("inventory_items")
      .select("id, micros_item_id")
      .eq("store_id", siteId)
      .in("micros_item_id", microsIds);

    const existingMap = new Map<string, string>(
      (existing ?? []).map((e: any) => [e.micros_item_id, e.id]),
    );

    for (const record of records) {
      const d = record.data;
      const microsItemId = String(d.micros_item_id);
      const existingId = existingMap.get(microsItemId);

      try {
        if (existingId) {
          const { error } = await (supabase as any)
            .from("inventory_items")
            .update({
              current_stock: d.current_stock,
              unit: d.unit,
              category: d.category,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingId)
            .eq("store_id", siteId);

          results.push({
            key: record.key,
            written: !error,
            skipped: false,
            error: error?.message,
          });
        } else {
          const { error } = await (supabase as any)
            .from("inventory_items")
            .insert({
              store_id: siteId,
              micros_item_id: microsItemId,
              name: d.name,
              category: d.category ?? "general",
              unit: d.unit ?? "ea",
              current_stock: d.current_stock,
              minimum_threshold: 0,
              par_level: 0,
              avg_daily_usage: 0,
              lead_time_days: 1,
              target_days_cover: 3,
            });

          results.push({
            key: record.key,
            written: !error,
            skipped: false,
            error: error?.message,
          });
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
   * Return checkpoint value (date-based).
   */
  getCheckpointValue(config: SyncConfig, _records: NormalizedRecord[]): string {
    return config.businessDate ?? new Date().toISOString().slice(0, 10);
  },
};
