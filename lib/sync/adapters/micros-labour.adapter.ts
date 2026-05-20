/**
 * lib/sync/adapters/micros-labour.adapter.ts
 *
 * Source adapter wrapping the existing labour sync functions for Sync Engine V2.
 * Delegates to runLabourFullSync / runLabourDeltaSync which handle the complete
 * fetch → normalize → upsert pipeline internally.
 */

import { isMicrosEnabled, getMicrosEnvConfig } from "@/lib/micros/config";
import { runLabourFullSync, runLabourDeltaSync } from "@/services/micros/labour/sync";
import { todayISO } from "@/lib/utils";
import type {
  SourceAdapter,
  SyncConfig,
  SyncCheckpoint,
  RawRecord,
  NormalizedRecord,
  WriteResult,
} from "../types";
import type { LabourSyncResult } from "@/types/labour";

// ── Raw record shape ─────────────────────────────────────────────────────

interface LabourRawRecord extends RawRecord {
  data: {
    result: LabourSyncResult;
    businessDate: string;
  };
}

// ── Adapter ──────────────────────────────────────────────────────────────

export const microsLabourAdapter: SourceAdapter<LabourRawRecord> = {
  /**
   * Phase 1: Validate MICROS is enabled and env config is present.
   */
  async validate(_config: SyncConfig): Promise<void> {
    if (!isMicrosEnabled()) {
      throw new Error("MICROS integration is disabled (MICROS_ENABLED != true)");
    }
    getMicrosEnvConfig(); // throws if required env vars are missing
  },

  /**
   * Phase 5: Run the labour sync.
   *
   * Full sync is used when a specific businessDate is supplied; delta sync
   * is used for scheduled/incremental runs (no date override).
   *
   * The existing sync functions handle auth, API fetch, normalize, and DB
   * upsert internally, so fetch here is the entire pipeline in one call.
   */
  async fetch(
    config: SyncConfig,
    _checkpoint?: SyncCheckpoint,
  ): Promise<LabourRawRecord[]> {
    const businessDate = config.businessDate ?? todayISO();
    const result = config.businessDate
      ? await runLabourFullSync(businessDate)
      : await runLabourDeltaSync();

    return [
      {
        key: `labour:${businessDate}`,
        data: { result, businessDate },
      },
    ];
  },

  /**
   * Phase 6: Pass through — sync functions already wrote records.
   */
  normalize(raw: LabourRawRecord[]): NormalizedRecord[] {
    return raw.map((r) => ({
      key: r.key,
      contentHash: r.data.businessDate,
      data: r.data as unknown as Record<string, unknown>,
    }));
  },

  /**
   * Phase 8: No-op write — DB writes already occurred in the fetch phase.
   * Returns WriteResult reflecting the inner sync outcome.
   */
  async write(
    records: NormalizedRecord[],
    _config: SyncConfig,
    _runId: string,
  ): Promise<WriteResult[]> {
    return records.map((r) => {
      const result = (r.data as unknown as { result: LabourSyncResult }).result;
      return {
        key: r.key,
        written: result.success,
        skipped: false,
        error: result.success ? undefined : result.message,
      };
    });
  },

  /**
   * Phase 9: Checkpoint = the business date synced.
   */
  getCheckpointValue(config: SyncConfig, _records: NormalizedRecord[]): string {
    return config.businessDate ?? todayISO();
  },
};
