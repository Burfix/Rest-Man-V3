/**
 * POST /api/micros/labour-upload
 *
 * Manual CSV upload fallback for labour data when Oracle API is offline.
 * Accepts CSV with columns: empNum, jobCode, businessDate,
 *   clockIn, clockOut, regHrs, regPay, ovtHrs, ovtPay
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CsvRow {
  empNum: string;
  jobCode: string;
  businessDate: string;
  clockIn: string;
  clockOut: string;
  regHrs: string;
  regPay: string;
  ovtHrs: string;
  ovtPay: string;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, message: "No file uploaded" },
        { status: 400 },
      );
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) {
      return NextResponse.json(
        { ok: false, message: "CSV must have a header row and at least one data row" },
        { status: 400 },
      );
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ""));

    const requiredCols = ["empnum", "jobcode", "businessdate", "reghrs", "regpay"];
    const missing = requiredCols.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      return NextResponse.json(
        { ok: false, message: `Missing required columns: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const sb = createServerClient();
    const now = new Date().toISOString();
    const locRef = process.env.MICROS_LOCATION_REF ?? process.env.MICROS_LOC_REF ?? "manual";
    let upserted = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] ?? "";
      });

      const regHrs = parseFloat(row.reghrs) || 0;
      const regPay = parseFloat(row.regpay) || 0;
      const ovtHrs = parseFloat(row.ovthrs) || 0;
      const ovtPay = parseFloat(row.ovtpay) || 0;

      const tcId = `csv_${row.empnum}_${row.businessdate || todayISO()}_${i}`;

      const { error } = await sb.from("labour_timecards").upsert(
        {
          tc_id: tcId,
          business_date: row.businessdate || todayISO(),
          loc_ref: locRef,
          emp_num: row.empnum ?? "",
          job_code_ref: row.jobcode ?? "",
          jc_num: row.jobcode ?? "",
          clk_in_lcl: row.clockin || null,
          clk_out_lcl: row.clockout || null,
          reg_hrs: regHrs,
          reg_pay: regPay,
          ovt1_hrs: ovtHrs,
          ovt1_pay: ovtPay,
          total_hours: regHrs + ovtHrs,
          total_pay: regPay + ovtPay,
          synced_at: now,
        },
        { onConflict: "tc_id" },
      );

      if (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
      } else {
        upserted++;
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      message: `Uploaded ${upserted} timecard rows${errors.length > 0 ? ` with ${errors.length} errors` : ""}`,
      upserted,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, message: msg }, { status: 500 });
  }
}
