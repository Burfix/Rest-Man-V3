/**
 * POST /api/sales/historical/upload
 *
 * Accepts multipart/form-data with:
 *   file — CSV with two columns:
 *           date       (Business Date / Date / sale_date / Day)
 *           gross_sales (Gross Sales / Net Sales / Total / Revenue / Sales)
 *
 * Accepted date formats: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, MM/DD/YY
 * Currency symbols (R, ZAR, $, £) and thousands commas are stripped.
 *
 * Upserts on sale_date — re-uploading the same date overwrites gross_sales.
 *
 * Returns:
 *   { count: number; dateRange: { from: string; to: string } | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// ── Column alias normalisation ────────────────────────────────────────────────

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const COLUMN_ALIASES: Record<string, string> = {
  // date variants
  date:         "sale_date",
  saledate:     "sale_date",
  businessdate: "sale_date",
  reportdate:   "sale_date",
  tradedate:    "sale_date",
  day:          "sale_date",
  // gross_sales variants
  grosssales:   "gross_sales",
  netsales:     "gross_sales",
  totalsales:   "gross_sales",
  sales:        "gross_sales",
  revenue:      "gross_sales",
  total:        "gross_sales",
  dailysales:   "gross_sales",
  amount:       "gross_sales",
  income:       "gross_sales",
};

const REQUIRED = ["sale_date", "gross_sales"];

// ── CSV parser ────────────────────────────────────────────────────────────────

/** RFC-4180-compliant CSV line splitter (handles quoted commas & escaped quotes). */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** Scan first 20 lines for the row that contains both required columns. */
function findHeaderRowIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const mapped = splitCsvLine(line).map((c) => {
      const n = normKey(c);
      return COLUMN_ALIASES[n] ?? n;
    });
    const hits = REQUIRED.filter((r) => mapped.includes(r)).length;
    if (hits === REQUIRED.length) return i;
  }
  return 0;
}

/** Convert common date formats to YYYY-MM-DD, or return null on failure. */
function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or DD/MM/YYYY with forward slashes
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const a = parseInt(m1[1], 10);
    const b = parseInt(m1[2], 10);
    const yr = m1[3];
    // If first part > 12 it must be DD/MM (SA), otherwise assume MM/DD (Toast)
    const [mo, dy] = a > 12 ? [b, a] : [a, b];
    return `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  }

  // MM/DD/YY short year
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m2) {
    const a = parseInt(m2[1], 10);
    const b = parseInt(m2[2], 10);
    const yr = 2000 + parseInt(m2[3], 10);
    const [mo, dy] = a > 12 ? [b, a] : [a, b];
    return `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  }

  // DD-MM-YYYY or MM-DD-YYYY with dashes
  const m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) {
    const a = parseInt(m3[1], 10);
    const b = parseInt(m3[2], 10);
    const yr = m3[3];
    const [mo, dy] = a > 12 ? [b, a] : [a, b];
    return `${yr}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
  }

  // Fallback: JS Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Strip currency symbols and parse as float. */
function toAmount(raw: string): number | null {
  const clean = raw
    .trim()
    .replace(/[R$£€]/gi, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  if (!clean) return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function parseCsv(text: string): { sale_date: string; gross_sales: number }[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerIdx = findHeaderRowIndex(lines);
  const headers = splitCsvLine(lines[headerIdx]).map((h) => {
    const n = normKey(h);
    return COLUMN_ALIASES[n] ?? n;
  });

  const rows: { sale_date: string; gross_sales: number }[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = splitCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx] ?? ""; });

    const rawDate   = (raw["sale_date"]   ?? "").trim();
    const rawAmount = (raw["gross_sales"] ?? "").trim();

    // Skip summary / total rows
    if (/^(total|subtotal|grand|average)/i.test(rawDate))   continue;
    if (/^(total|subtotal|grand|average)/i.test(rawAmount)) continue;

    const saleDate   = toIsoDate(rawDate);
    const grossSales = toAmount(rawAmount);
    if (!saleDate || grossSales === null) continue;

    rows.push({ sale_date: saleDate, gross_sales: grossSales });
  }

  return rows;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'No valid rows found. CSV must have a "date" (or "Business Date") column ' +
            'and a "gross_sales" (or "Gross Sales" / "Net Sales") column.',
        },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();
    const payload = rows.map((r) => ({ ...r, updated_at: now }));

    const supabase = createServerClient();
    // historical_sales is not in the auto-generated Supabase types yet (new table).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase.from("historical_sales") as any)
      .upsert(payload, { onConflict: "sale_date", count: "exact" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const dates = rows.map((r) => r.sale_date).sort();

    return NextResponse.json(
      {
        count: count ?? rows.length,
        dateRange: { from: dates[0], to: dates[dates.length - 1] },
      },
      { status: 201 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
