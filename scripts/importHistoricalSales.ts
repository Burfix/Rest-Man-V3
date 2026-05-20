/**
 * importHistoricalSales.ts
 *
 * CLI script: reads a CSV file and upserts daily revenue into `historical_sales`.
 *
 * CSV format (header row required):
 *   date,gross_sales_net_vat
 *   2024-03-01,14250.50
 *   2024-03-02,11800.00
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/importHistoricalSales.ts path/to/sales.csv
 *
 * Environment variables (from .env.local or environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.\n" +
      "    Run: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx ts-node -r dotenv/config scripts/importHistoricalSales.ts file.csv"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CLI arg ──────────────────────────────────────────────────────────────────

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx ts-node -r dotenv/config scripts/importHistoricalSales.ts <path-to-csv>");
  process.exit(1);
}

const resolvedPath = path.resolve(csvPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`❌  File not found: ${resolvedPath}`);
  process.exit(1);
}

// ── Parse CSV ────────────────────────────────────────────────────────────────

interface Row {
  sale_date: string;
  gross_sales: number;
}

async function parseCsv(filePath: string): Promise<Row[]> {
  const rows: Row[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  let dateIdx = -1;
  let salesIdx = -1;

  for await (const line of rl) {
    lineNo++;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    if (lineNo === 1) {
      // Header row — detect column positions
      dateIdx = cols.findIndex((c) => /^date$/i.test(c));
      salesIdx = cols.findIndex((c) => /gross_sales_net_vat|gross_sales|revenue/i.test(c));

      if (dateIdx === -1 || salesIdx === -1) {
        console.error(
          `❌  Header row must contain "date" and "gross_sales_net_vat" columns.\n` +
            `    Found: ${cols.join(", ")}`
        );
        process.exit(1);
      }

      console.log(`✓  Header detected — date col: ${dateIdx}, sales col: ${salesIdx}`);
      continue;
    }

    const dateStr = cols[dateIdx];
    const salesRaw = cols[salesIdx];

    if (!dateStr || !salesRaw) continue; // skip blank lines

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.warn(`⚠  Line ${lineNo}: skipping invalid date "${dateStr}"`);
      continue;
    }

    const sales = parseFloat(salesRaw.replace(/[^\d.]/g, ""));
    if (isNaN(sales)) {
      console.warn(`⚠  Line ${lineNo}: skipping non-numeric sales "${salesRaw}"`);
      continue;
    }

    rows.push({ sale_date: dateStr, gross_sales: sales });
  }

  return rows;
}

// ── Upsert in batches ────────────────────────────────────────────────────────

const BATCH_SIZE = 100;

async function upsertRows(rows: Row[]): Promise<void> {
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await (supabase as any)
      .from("historical_sales")
      .upsert(batch, { onConflict: "sale_date" });

    if (error) {
      console.error(`❌  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
      failed += batch.length;
    } else {
      inserted += batch.length;
      const pct = Math.round(((i + batch.length) / rows.length) * 100);
      process.stdout.write(`\r   Upserted ${inserted} / ${rows.length} rows (${pct}%)`);
    }
  }

  console.log(); // newline after progress
  if (failed > 0) {
    console.warn(`⚠  ${failed} row(s) failed to upsert.`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📂  Reading: ${resolvedPath}`);
  const rows = await parseCsv(resolvedPath);

  if (rows.length === 0) {
    console.warn("⚠  No valid rows found in CSV. Nothing to import.");
    process.exit(0);
  }

  console.log(`📊  Parsed ${rows.length} valid row(s). Importing to Supabase…\n`);
  await upsertRows(rows);

  console.log(`\n✅  Import complete — ${rows.length} row(s) processed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
