/**
 * lib/mappers/salesMapper.ts
 *
 * Mapping layer for manual sales uploads.
 *
 * Schema fields use snake_case (`business_date`, `gross_sales`, etc.).
 * Internal route logic uses camelCase. DB payloads use explicit snake_case.
 */

import type { z } from "zod";
import type { manualSalesSchema } from "@/lib/validation/schemas";

// ── DTO type ──────────────────────────────────────────────────────────────────

export type ManualSalesDto = z.infer<typeof manualSalesSchema>;

// ── Internal type ─────────────────────────────────────────────────────────────

export interface ManualSalesInternal {
  businessDate: string;
  grossSales: number | null | undefined;
  covers: number | null | undefined;
  checks: number | null | undefined;
  avgSpendPerCover: number | null | undefined;
  avgCheckValue: number | null | undefined;
  labourPercent: number | null | undefined;
  notes: string | null | undefined;
  sourceFileName: string | null | undefined;
}

// ── DTO → Internal ─────────────────────────────────────────────────────────────

export function manualSalesDtoToInternal(dto: ManualSalesDto): ManualSalesInternal {
  return {
    businessDate: dto.business_date,
    grossSales: dto.gross_sales,
    covers: dto.covers,
    checks: dto.checks,
    avgSpendPerCover: dto.avg_spend_per_cover,
    avgCheckValue: dto.avg_check_value,
    labourPercent: dto.labour_percent,
    notes: dto.notes,
    sourceFileName: dto.source_file_name,
  };
}

// ── Internal → DB ─────────────────────────────────────────────────────────────

export function manualSalesInternalToDb(
  input: ManualSalesInternal,
  siteId: string,
  uploadedBy: string,
) {
  return {
    site_id: siteId,
    business_date: input.businessDate,
    gross_sales: input.grossSales ?? null,
    net_sales: null as null,
    covers: input.covers ?? null,
    checks: input.checks ?? null,
    avg_spend_per_cover: input.avgSpendPerCover ?? null,
    avg_check_value: input.avgCheckValue ?? null,
    labour_percent: input.labourPercent ?? null,
    notes: input.notes ?? null,
    source_file_name: input.sourceFileName ?? null,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
  };
}
