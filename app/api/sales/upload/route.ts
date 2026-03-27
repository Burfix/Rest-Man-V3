/**
 * POST /api/sales/upload
 *
 * Accepts multipart/form-data with:
 *   file       — CSV file exported from Toast POS or with columns:
 *                item_name / Item / Menu Item
 *                quantity_sold / Qty Sold / Qty / Count
 *                sales_amount / Net Sales / Gross Sales / Sales
 *                category (optional), unit_price / Price (optional)
 *                Metadata/preamble rows before the header are skipped automatically.
 *   week_label — display label e.g. "Week 10 — 3–9 Mar 2026"
 *   week_start — YYYY-MM-DD
 *   week_end   — YYYY-MM-DD
 *
 * Optional CSV columns: category, unit_price
 *
 * Returns:
 *   { upload: SalesUpload; itemCount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";

const REQUIRED_HEADERS = ["item_name", "quantity_sold", "sales_amount"];

// ─── CSV parser ───────────────────────────────────────────────────────────────

/** Normalize a header cell: lowercase, strip all non-alphanumeric chars. */
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map common Toast POS (and generic) column names to internal names.
 * Keys are already normalized via normKey().
 */
const COLUMN_ALIASES: Record<string, string> = {
  // item_name — covers "Menu Item Name", "Item", "Menu Item", "Name", etc.
  menuitemname: "item_name",
  menuitem: "item_name",
  itemname: "item_name",
  item: "item_name",
  name: "item_name",
  product: "item_name",
  description: "item_name",
  // quantity_sold — covers "Quantity Sold", "Qty Sold", "Qty", etc.
  quantitysold: "quantity_sold",
  qtysold: "quantity_sold",
  qty: "quantity_sold",
  quantity: "quantity_sold",
  count: "quantity_sold",
  qtycount: "quantity_sold",
  unitssold: "quantity_sold",
  sold: "quantity_sold",
  // sales_amount — "Sales Less Item Discounts" takes precedence over "Gross Sales"
  // (it comes later in the row so it naturally overwrites the gross value)
  saleslessitemdiscounts: "sales_amount",
  netsales: "sales_amount",
  grosssales: "sales_amount",
  sales: "sales_amount",
  totalsales: "sales_amount",
  amount: "sales_amount",
  revenue: "sales_amount",
  // category
  menucategory: "category",
  group: "category",
  // unit_price — covers "Average Price", "Avg Price", "Price", "Unit Price"
  averageprice: "unit_price",
  avgprice: "unit_price",
  price: "unit_price",
  unitprice: "unit_price",
};

/** RFC-4180-compliant CSV line splitter (handles quoted commas & escaped quotes). */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
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

/**
 * Scan the first 20 lines to find the row whose columns, after alias mapping,
 * contain all three required headers. Falls back to line 0 if not found.
 */
function findHeaderRowIndex(lines: string[]): number {
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const mapped = splitCsvLine(line).map((c) => {
      const n = normKey(c);
      return COLUMN_ALIASES[n] ?? n;
    });
    const hits = REQUIRED_HEADERS.filter((r) => mapped.includes(r)).length;
    if (hits === REQUIRED_HEADERS.length) return i;
  }
  return 0;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerIdx = findHeaderRowIndex(lines);
  const headers = splitCsvLine(lines[headerIdx]).map((h) => {
    const n = normKey(h);
    return COLUMN_ALIASES[n] ?? n;
  });

  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? "";
    });
    // Skip total/summary rows (item_name absent or starts with "Total"/"Subtotal")
    const itemVal = (row.item_name ?? "").trim();
    if (!itemVal || /^(total|subtotal|grand total)/i.test(itemVal)) continue;
    rows.push(row);
  }

  return rows;
}

function validateHeaders(rows: Record<string, string>[]): string | null {
  if (rows.length === 0) return "CSV file is empty or has no data rows.";
  const keys = Object.keys(rows[0]);
  const missing = REQUIRED_HEADERS.filter((h) => !keys.includes(h));
  if (missing.length > 0) {
    return `CSV is missing required columns: ${missing.join(", ")}. Found: ${keys.join(", ")}`;
  }
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const weekLabel = (formData.get("week_label") as string | null)?.trim();
    const weekStart = (formData.get("week_start") as string | null)?.trim();
    const weekEnd = (formData.get("week_end") as string | null)?.trim();

    if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (!weekLabel || !weekStart || !weekEnd) {
      return NextResponse.json(
        { error: "week_label, week_start, and week_end are required." },
        { status: 400 }
      );
    }

    const text = await file.text();
    const rows = parseCsv(text);
    const validationError = validateHeaders(rows);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 422 });
    }

    // Parse and aggregate totals
    let totalItemsSold = 0;
    let totalSalesValue = 0;

    const items = rows
      .map((row) => {
        const qty = parseInt(row.quantity_sold ?? "0", 10);
        const amount = parseFloat(row.sales_amount ?? "0");
        const unitPrice = row.unit_price ? parseFloat(row.unit_price) : null;

        if (isNaN(qty) || isNaN(amount)) return null;

        totalItemsSold += qty;
        totalSalesValue += amount;

        return {
          item_name: row.item_name as string,
          category: row.category || null,
          quantity_sold: qty,
          unit_price: unitPrice && !isNaN(unitPrice) ? unitPrice : null,
          total_value: amount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No valid data rows found in the CSV." },
        { status: 422 }
      );
    }

    const supabase = createServerClient();

    // Resolve the site for this upload (falls back to default pilot-store ID)
    const DEFAULT_SITE_ID = "00000000-0000-0000-0000-000000000001";
    let siteId = DEFAULT_SITE_ID;
    try {
      const ctx = await getUserContext();
      siteId = ctx.siteId || DEFAULT_SITE_ID;
    } catch {
      // Not authenticated — shouldn't happen behind middleware
    }

    // Insert upload header row
    const { data: uploadData, error: uploadErr } = await supabase
      .from("sales_uploads")
      .insert({
        site_id: siteId,
        week_label: weekLabel,
        week_start: weekStart,
        week_end: weekEnd,
        total_items_sold: totalItemsSold,
        total_sales_value: totalSalesValue,
      })
      .select("*")
      .single();

    // Cast to known shape — Supabase's generic inference requires auto-generated types
    const upload = uploadData as
      | { id: string; [key: string]: unknown }
      | null;

    if (uploadErr || !upload) {
      return NextResponse.json(
        { error: uploadErr?.message ?? "Failed to create upload record." },
        { status: 500 }
      );
    }

    // Insert line items
    const itemsWithUploadId = items.map((item) => ({
      ...item,
      upload_id: upload.id,
    }));

    const { error: itemsErr } = await supabase
      .from("sales_items")
      .insert(itemsWithUploadId);

    if (itemsErr) {
      // Clean up orphaned upload header
      await supabase.from("sales_uploads").delete().eq("id", upload.id);
      return NextResponse.json(
        { error: itemsErr.message ?? "Failed to save line items." },
        { status: 500 }
      );
    }

    return NextResponse.json({ upload, itemCount: items.length }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
