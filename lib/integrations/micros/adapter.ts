/**
 * Micros / POS Sales Integration Adapter
 *
 * Pulls daily sales data from the Micros POS API (or compatible
 * REST endpoint), validates each record, writes raw → canonical.
 *
 * Canonical target: revenue_records
 *
 * To connect a real POS system:
 *   1. Set MICROS_API_URL and MICROS_API_KEY in environment variables.
 *   2. Implement the fetch() method body (replace the placeholder).
 *   3. Adjust validate() for the actual response schema.
 *   4. Adjust transform() field mapping as needed.
 */

import {
  BaseIntegrationAdapter,
  type AdapterConfig,
  type FetchResult,
  type ValidationResult,
} from "@/lib/integrations/base/adapter";
import { writeAuditLog } from "@/lib/audit/auditLog";

// ── Raw payload from Micros ────────────────────────────────────────────────────

interface MicrosRecord {
  transaction_id:   string;
  business_date:    string;          // "YYYY-MM-DD"
  period:           string;          // "Lunch" | "Dinner" | "All"
  gross_sales:      number;
  discounts:        number;
  refunds:          number;
  vat_inclusive:    number;
  covers:           number;
  closed_at:        string;          // ISO timestamp
}

// ── Canonical form ─────────────────────────────────────────────────────────────

interface RevenueRecordInsert {
  site_id:       string;
  service_date:  string;
  period_label:  string;
  gross_sales:   number;
  discounts:     number;
  refunds:       number;
  vat_amount:    number | null;
  net_vat_excl:  number | null;
  covers:        number;
  source:        string;
  raw_record_id: string;
}

// ── Adapter ────────────────────────────────────────────────────────────────────

export class MicrosAdapter extends BaseIntegrationAdapter<MicrosRecord, RevenueRecordInsert> {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private authToken: string | null = null;

  constructor(config: AdapterConfig) {
    super({ ...config, sourceType: "micros" });
    this.apiUrl = process.env.MICROS_API_URL ?? "";
    this.apiKey = process.env.MICROS_API_KEY ?? "";
  }

  protected async authenticate(): Promise<void> {
    if (!this.apiUrl || !this.apiKey) {
      // No credentials configured — adapter runs in stub/dry-run mode
      this.authToken = null;
      return;
    }
    // Exchange API key for a short-lived bearer token
    const res = await fetch(`${this.apiUrl}/auth/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ api_key: this.apiKey }),
    });
    if (!res.ok) throw new Error(`[Micros] Auth failed: ${res.status}`);
    const json = await res.json();
    this.authToken = json.access_token;
  }

  protected async fetch(): Promise<FetchResult<MicrosRecord>> {
    if (!this.authToken) {
      // Stub: return empty — production environment will configure credentials
      return { records: [] };
    }

    const today = new Date().toISOString().slice(0, 10);
    const res   = await fetch(
      `${this.apiUrl}/sales?site_id=${this.siteId}&date=${today}`,
      { headers: { Authorization: `Bearer ${this.authToken}` } }
    );
    if (!res.ok) throw new Error(`[Micros] Fetch failed: ${res.status}`);
    const json = await res.json();
    return { records: Array.isArray(json.records) ? json.records : [] };
  }

  protected validate(record: MicrosRecord): ValidationResult {
    const errors: string[] = [];
    if (!record.transaction_id)         errors.push("Missing transaction_id");
    if (!record.business_date)          errors.push("Missing business_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.business_date))
                                        errors.push("business_date must be YYYY-MM-DD");
    if (typeof record.gross_sales !== "number" || record.gross_sales < 0)
                                        errors.push("gross_sales must be a non-negative number");
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  protected extractSourceRecordId(record: MicrosRecord): string {
    return record.transaction_id;
  }

  protected async persistRaw(
    record:          MicrosRecord,
    sourceRecordId:  string,
    batchId:         string
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from("raw_micros_sales")
      .insert({
        site_id:          this.siteId,
        source_record_id: sourceRecordId,
        sync_batch_id:    batchId,
        source_payload:   record,
        validation_status: "valid",
      })
      .select("id")
      .single();

    if (error) {
      // UNIQUE violation → duplicate, skip silently
      if (error.code === "23505") return null;
      throw error;
    }
    return data?.id ?? null;
  }

  protected transform(record: MicrosRecord, rawId: string): RevenueRecordInsert {
    const net    = record.gross_sales - record.discounts - record.refunds;
    const vatPct = 0.15;                         // 15% South African VAT
    const netVatExcl = +(net / (1 + vatPct)).toFixed(2);

    return {
      site_id:       this.siteId,
      service_date:  record.business_date,
      period_label:  record.period,
      gross_sales:   record.gross_sales,
      discounts:     record.discounts,
      refunds:       record.refunds,
      vat_amount:    +(net - netVatExcl).toFixed(2),
      net_vat_excl:  netVatExcl,
      covers:        record.covers,
      source:        "micros",
      raw_record_id: rawId,
    };
  }

  protected async persistCanonical(record: RevenueRecordInsert): Promise<string | null> {
    const { data, error } = await this.db
      .from("revenue_records")
      .upsert(record, { onConflict: "site_id,service_date,period_label,source" })
      .select("id")
      .single();

    if (error) throw new Error(`[Micros] Canonical write failed: ${error.message}`);

    await writeAuditLog({
      entityType: "revenue_record",
      entityId:   data.id,
      operation:  "create",
      actorLabel: "system:micros",
      siteId:     this.siteId,
      afterState: record as unknown as Record<string, unknown>,
    });

    return data.id;
  }
}
