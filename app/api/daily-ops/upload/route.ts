/**
 * POST /api/daily-ops/upload
 *
 * Accepts multipart/form-data:
 *   file        — Toast daily operations CSV export (required)
 *   report_date — YYYY-MM-DD (required)
 *
 * Returns:
 *   201 { report, laborCount, revenueCenterCount }
 *   409 { error, code: "DUPLICATE", report }
 *   400 { error }
 *   500 { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseDailyOperationsCsv } from "@/lib/parsers/dailyOperationsCsv";
import { saveDailyOperationsReport } from "@/services/ops/dailyOperationsSummary";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    const reportDate = (formData.get("report_date") as string | null)?.trim();

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (!reportDate || !DATE_RE.test(reportDate)) {
      return NextResponse.json(
        { error: "report_date is required and must be YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".csv") && !file.type.includes("csv") && !file.type.includes("text")) {
      return NextResponse.json(
        { error: "Only CSV files are accepted." },
        { status: 400 }
      );
    }

    const text = await file.text();

    if (!text.trim()) {
      return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
    }

    // Parse
    const parsed = parseDailyOperationsCsv(text);

    // Top-level validation: must have at least sales data
    if (parsed.topMetrics.salesNetVat == null) {
      return NextResponse.json(
        {
          error:
            "Could not read Sales Net VAT from the uploaded file. Make sure this is a Toast Daily Operations CSV export.",
          parseWarnings: parsed.parseWarnings,
        },
        { status: 400 }
      );
    }

    // Save (duplicate detection happens inside)
    const result = await saveDailyOperationsReport(parsed, file.name, reportDate);

    if (result.duplicate) {
      return NextResponse.json(
        {
          error: `A report for ${reportDate} already exists.`,
          code: "DUPLICATE",
          report: result.report,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        report: result.report,
        laborCount: result.laborCount,
        revenueCenterCount: result.revenueCenterCount,
        parseWarnings: parsed.parseWarnings,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error.";
    console.error("[daily-ops/upload]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
