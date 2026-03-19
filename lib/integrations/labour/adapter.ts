/**
 * Labour / Payroll Integration Adapter
 *
 * Pulls shift data from a payroll / scheduling system, validates,
 * deduplicates, then writes raw → canonical labour_records.
 *
 * To connect a real payroll system:
 *   1. Set LABOUR_API_URL and LABOUR_API_KEY in environment variables.
 *   2. Implement authenticate() and fetch() for your provider.
 *   3. Adjust field mapping in transform().
 */

import {
  BaseIntegrationAdapter,
  type AdapterConfig,
  type FetchResult,
  type ValidationResult,
} from "@/lib/integrations/base/adapter";
import { writeAuditLog } from "@/lib/audit/auditLog";

// ── Raw payload ────────────────────────────────────────────────────────────────

interface LabourShiftRecord {
  shift_id:       string;
  employee_id:    string;
  employee_name:  string;
  role:           string;
  department:     string;
  shift_date:     string;   // YYYY-MM-DD
  shift_start:    string;   // HH:MM
  shift_end:      string;   // HH:MM
  hours_worked:   number;
  hourly_rate:    number;
}

// ── Canonical form ─────────────────────────────────────────────────────────────

interface LabourRecordInsert {
  site_id:        string;
  service_date:   string;
  employee_id:    string;
  employee_name:  string;
  role:           string;
  shift_start:    string;
  shift_end:      string;
  hours_worked:   number;
  hourly_rate:    number;
  labour_cost:    number;
  department:     string;
  source:         string;
  raw_record_id:  string;
}

// ── Adapter ────────────────────────────────────────────────────────────────────

export class LabourAdapter extends BaseIntegrationAdapter<LabourShiftRecord, LabourRecordInsert> {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(config: AdapterConfig) {
    super({ ...config, sourceType: "labour" });
    this.apiUrl = process.env.LABOUR_API_URL ?? "";
    this.apiKey = process.env.LABOUR_API_KEY ?? "";
  }

  protected async authenticate(): Promise<void> {
    // Credentials validated at fetch time via API key header
  }

  protected async fetch(): Promise<FetchResult<LabourShiftRecord>> {
    if (!this.apiUrl || !this.apiKey) return { records: [] };

    const today = new Date().toISOString().slice(0, 10);
    const res   = await fetch(
      `${this.apiUrl}/shifts?site_id=${this.siteId}&date=${today}`,
      { headers: { "X-Api-Key": this.apiKey } }
    );
    if (!res.ok) throw new Error(`[Labour] Fetch failed: ${res.status}`);
    const json = await res.json();
    return { records: Array.isArray(json.shifts) ? json.shifts : [] };
  }

  protected validate(record: LabourShiftRecord): ValidationResult {
    const errors: string[] = [];
    if (!record.shift_id)       errors.push("Missing shift_id");
    if (!record.employee_id)    errors.push("Missing employee_id");
    if (!record.shift_date)     errors.push("Missing shift_date");
    if (typeof record.hours_worked !== "number" || record.hours_worked < 0)
                                errors.push("hours_worked must be a non-negative number");
    if (typeof record.hourly_rate !== "number" || record.hourly_rate < 0)
                                errors.push("hourly_rate must be a non-negative number");
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  protected extractSourceRecordId(record: LabourShiftRecord): string {
    return record.shift_id;
  }

  protected async persistRaw(
    record:          LabourShiftRecord,
    sourceRecordId:  string,
    batchId:         string
  ): Promise<string | null> {
    const { data, error } = await this.db
      .from("raw_labour_data")
      .insert({
        site_id:           this.siteId,
        source_record_id:  sourceRecordId,
        sync_batch_id:     batchId,
        source_payload:    record,
        validation_status: "valid",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") return null; // duplicate
      throw error;
    }
    return data?.id ?? null;
  }

  protected transform(record: LabourShiftRecord, rawId: string): LabourRecordInsert {
    return {
      site_id:       this.siteId,
      service_date:  record.shift_date,
      employee_id:   record.employee_id,
      employee_name: record.employee_name,
      role:          record.role,
      shift_start:   record.shift_start,
      shift_end:     record.shift_end,
      hours_worked:  record.hours_worked,
      hourly_rate:   record.hourly_rate,
      labour_cost:   +(record.hours_worked * record.hourly_rate).toFixed(2),
      department:    record.department,
      source:        "labour_api",
      raw_record_id: rawId,
    };
  }

  protected async persistCanonical(record: LabourRecordInsert): Promise<string | null> {
    const { data, error } = await this.db
      .from("labour_records")
      .insert(record)
      .select("id")
      .single();

    if (error) throw new Error(`[Labour] Canonical write failed: ${error.message}`);

    await writeAuditLog({
      entityType: "labour_record",
      entityId:   data.id,
      operation:  "create",
      actorLabel: "system:labour",
      siteId:     this.siteId,
      afterState: record as unknown as Record<string, unknown>,
    });

    return data.id;
  }
}
