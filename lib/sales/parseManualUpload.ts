/**
 * lib/sales/parseManualUpload.ts — Parse and validate manual sales input
 *
 * Accepts a simple object (from CSV row or form submission) and
 * validates it before DB insertion. No external dependencies.
 */

export interface ManualSalesInput {
  business_date: string;
  gross_sales: number;
  net_sales?: number | null;
  covers: number;
  checks: number;
  avg_spend_per_cover?: number | null;
  avg_check_value?: number | null;
  labour_percent?: number | null;
  notes?: string | null;
}

export type ParseResult =
  | { success: true; data: ManualSalesInput }
  | { success: false; errors: string[] };

export function parseManualSalesInput(raw: Record<string, unknown>): ParseResult {
  const errors: string[] = [];

  const business_date = String(raw.business_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(business_date)) {
    errors.push("business_date: Must be YYYY-MM-DD format");
  }

  const gross_sales = Number(raw.gross_sales);
  if (isNaN(gross_sales) || gross_sales <= 0) {
    errors.push("gross_sales: Must be a positive number");
  }

  const net_sales = raw.net_sales != null && raw.net_sales !== "" ? Number(raw.net_sales) : null;
  if (net_sales != null && (isNaN(net_sales) || net_sales <= 0)) {
    errors.push("net_sales: Must be a positive number");
  }

  const covers = Number(raw.covers ?? 0);
  if (isNaN(covers) || covers < 0 || !Number.isInteger(covers)) {
    errors.push("covers: Must be a non-negative integer");
  }

  const checks = Number(raw.checks ?? 0);
  if (isNaN(checks) || checks < 0 || !Number.isInteger(checks)) {
    errors.push("checks: Must be a non-negative integer");
  }

  const avg_spend_per_cover = raw.avg_spend_per_cover != null && raw.avg_spend_per_cover !== "" ? Number(raw.avg_spend_per_cover) : null;
  if (avg_spend_per_cover != null && (isNaN(avg_spend_per_cover) || avg_spend_per_cover < 0)) {
    errors.push("avg_spend_per_cover: Must be a non-negative number");
  }

  const avg_check_value = raw.avg_check_value != null && raw.avg_check_value !== "" ? Number(raw.avg_check_value) : null;
  if (avg_check_value != null && (isNaN(avg_check_value) || avg_check_value < 0)) {
    errors.push("avg_check_value: Must be a non-negative number");
  }

  const labour_percent = raw.labour_percent != null && raw.labour_percent !== "" ? Number(raw.labour_percent) : null;
  if (labour_percent != null && (isNaN(labour_percent) || labour_percent < 0 || labour_percent > 100)) {
    errors.push("labour_percent: Must be between 0 and 100");
  }

  const notes = raw.notes != null ? String(raw.notes).slice(0, 500) : null;

  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      business_date,
      gross_sales,
      net_sales,
      covers,
      checks,
      avg_spend_per_cover,
      avg_check_value,
      labour_percent,
      notes,
    },
  };
}

/**
 * Parse a CSV string into an array of manual sales input rows.
 * Expects a header row with snake_case column names matching the schema.
 */
export function parseManualSalesCsv(csvText: string): ParseResult[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) {
    return [{ success: false, errors: ["CSV must have a header row and at least one data row"] }];
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const results: ParseResult[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (vals[j] !== undefined && vals[j] !== "") obj[h] = vals[j];
    });
    results.push(parseManualSalesInput(obj));
  }

  return results;
}
