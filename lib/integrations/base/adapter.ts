/**
 * Base Integration Adapter
 *
 * All source-specific adapters extend this abstract class.
 * The run() method enforces the canonical ingestion lifecycle:
 *
 *   authenticate → fetch → validate → deduplicate → write raw
 *   → transform → write canonical → close batch
 *
 * No data flows directly to canonical tables without passing
 * through raw storage and validation first.
 */

import { createClient } from "@supabase/supabase-js";
import type { SyncBatch } from "@/lib/ontology/entities";

export interface AdapterConfig {
  siteId:    string;
  sourceType: "micros" | "labour" | "reviews" | "compliance";
  initiatedBy?: string;
}

export interface FetchResult<T> {
  records: T[];
  cursor?: string;   // for paginated APIs
}

export interface ValidationResult {
  valid:   boolean;
  errors?: string[];
}

export interface AdapterRunResult {
  batchId:        string;
  recordsFound:   number;
  recordsValid:   number;
  recordsFailed:  number;
  status:         SyncBatch["status"];
  errors:         { recordId: string; errors: string[] }[];
}

export abstract class BaseIntegrationAdapter<TRaw, TCanonical> {
  protected readonly siteId: string;
  protected readonly sourceType: AdapterConfig["sourceType"];
  protected readonly initiatedBy: string;
  protected batchId: string | null = null;

  /** Service-role Supabase client — bypasses RLS for ingestion writes. */
  protected readonly db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  constructor(config: AdapterConfig) {
    this.siteId       = config.siteId;
    this.sourceType   = config.sourceType;
    this.initiatedBy  = config.initiatedBy ?? "system:cron";
  }

  // ── Abstract interface (override in concrete adapters) ─────────────────────

  /** Obtain credentials / session token for the source system. */
  protected abstract authenticate(): Promise<void>;

  /** Retrieve raw records from the source system. */
  protected abstract fetch(): Promise<FetchResult<TRaw>>;

  /** Validate a single raw record. Return { valid: true } or { valid: false, errors }. */
  protected abstract validate(record: TRaw): ValidationResult;

  /** Derive the stable source-side unique key from a raw record. */
  protected abstract extractSourceRecordId(record: TRaw): string;

  /** Write a valid raw record to the appropriate raw_* table. Returns written id. */
  protected abstract persistRaw(
    record:        TRaw,
    sourceRecordId: string,
    batchId:       string
  ): Promise<string | null>;

  /** Transform a raw record into canonical form. */
  protected abstract transform(record: TRaw, rawId: string): TCanonical;

  /** Write a canonical record and return its id. */
  protected abstract persistCanonical(record: TCanonical): Promise<string | null>;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async run(): Promise<AdapterRunResult> {
    const batchId = await this.openBatch();
    this.batchId  = batchId;

    let recordsFound  = 0;
    let recordsValid  = 0;
    let recordsFailed = 0;
    const errors: AdapterRunResult["errors"] = [];

    try {
      await this.authenticate();
      const { records } = await this.fetch();
      recordsFound = records.length;

      for (const record of records) {
        const sourceRecordId = this.extractSourceRecordId(record);

        // Validate
        const vr = this.validate(record);
        if (!vr.valid) {
          recordsFailed++;
          errors.push({ recordId: sourceRecordId, errors: vr.errors ?? [] });
          await this.markRawInvalid(sourceRecordId, vr.errors ?? []);
          continue;
        }

        // Persist raw (idempotent — ON CONFLICT DO NOTHING in concrete adapters)
        const rawId = await this.persistRaw(record, sourceRecordId, batchId);
        if (!rawId) {
          // Duplicate — already processed
          recordsFailed++;
          continue;
        }

        // Transform and persist canonical
        try {
          const canonical   = this.transform(record, rawId);
          const canonicalId = await this.persistCanonical(canonical);
          if (canonicalId) {
            await this.markRawTransformed(rawId, canonicalId);
          }
          recordsValid++;
        } catch (err) {
          recordsFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ recordId: sourceRecordId, errors: [msg] });
          await this.logIntegrationError(msg, batchId, record);
        }
      }

      const status: SyncBatch["status"] =
        recordsFailed === 0 ? "success" :
        recordsValid  > 0   ? "partial" : "failed";

      await this.closeBatch(batchId, recordsFound, recordsValid, recordsFailed, status);
      return { batchId, recordsFound, recordsValid, recordsFailed, status, errors };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.closeBatch(batchId, recordsFound, recordsValid, recordsFailed, "failed", msg);
      await this.logIntegrationError(msg, batchId, null);
      throw err;
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private async openBatch(): Promise<string> {
    const { data, error } = await this.db
      .from("sync_batches")
      .insert({
        site_id:      this.siteId,
        source_type:  this.sourceType,
        status:       "running",
        initiated_by: this.initiatedBy,
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(`[Adapter] Could not open sync batch: ${error?.message}`);
    return data.id;
  }

  private async closeBatch(
    batchId:        string,
    recordsFound:   number,
    recordsValid:   number,
    recordsFailed:  number,
    status:         SyncBatch["status"],
    errorMessage?:  string
  ): Promise<void> {
    await this.db.from("sync_batches").update({
      completed_at:   new Date().toISOString(),
      records_found:  recordsFound,
      records_valid:  recordsValid,
      records_failed: recordsFailed,
      status,
      error_message:  errorMessage ?? null,
    }).eq("id", batchId);
  }

  private async markRawInvalid(sourceRecordId: string, errors: string[]): Promise<void> {
    // Raw tables all share the same column contract; concrete adapters can
    // override this if they need custom table names.
    const table = this.rawTableName();
    await this.db.from(table as any).update({
      validation_status: "invalid",
      validation_errors: errors,
    }).eq("source_record_id", sourceRecordId).eq("site_id", this.siteId);
  }

  private async markRawTransformed(rawId: string, canonicalId: string): Promise<void> {
    const table = this.rawTableName();
    await this.db.from(table as any).update({
      validation_status: "transformed",
      transformed_at:    new Date().toISOString(),
      canonical_id:      canonicalId,
    }).eq("id", rawId);
  }

  protected rawTableName(): string {
    const map: Record<AdapterConfig["sourceType"], string> = {
      micros:      "raw_micros_sales",
      labour:      "raw_labour_data",
      reviews:     "raw_reviews",
      compliance:  "raw_compliance_uploads",
    };
    return map[this.sourceType];
  }

  protected async logIntegrationError(
    message:  string,
    batchId:  string,
    payload:  unknown
  ): Promise<void> {
    await this.db.from("integration_errors").insert({
      site_id:       this.siteId,
      source_type:   this.sourceType,
      sync_batch_id: batchId,
      error_message: message,
      payload_sample: payload
        ? JSON.parse(JSON.stringify(payload).slice(0, 2000))
        : null,
    });
  }
}
