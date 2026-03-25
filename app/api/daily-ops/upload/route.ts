import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { parseDailyOperationsCsv } from "@/lib/parsers/dailyOperationsCsv";
import { saveDailyOperationsReport } from "@/services/ops/dailyOperationsSummary";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/daily-ops/upload");
  if (guard.error) return guard.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const reportDate = (formData.get("report_date") as string | null)?.trim();

    if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (!reportDate || !DATE_RE.test(reportDate)) {
      return NextResponse.json({ error: "report_date is required and must be YYYY-MM-DD." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".csv") && !file.type.includes("csv") && !file.type.includes("text")) {
      return NextResponse.json({ error: "Only CSV files are accepted." }, { status: 400 });
    }

    const text = await file.text();
    if (!text.trim()) return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });

    const parsed = parseDailyOperationsCsv(text);

    if (parsed.topMetrics.salesNetVat == null) {
      return NextResponse.json(
        { error: "Could not read Sales Net VAT from the uploaded file.", parseWarnings: parsed.parseWarnings },
        { status: 400 },
      );
    }

    const result = await saveDailyOperationsReport(parsed, file.name, reportDate);
    if (result.duplicate) {
      return NextResponse.json(
        { error: `A report for ${reportDate} already exists.`, code: "DUPLICATE", report: result.report },
        { status: 409 },
      );
    }

    logger.info("Daily ops report uploaded", { route: "POST /api/daily-ops/upload", date: reportDate });
    return NextResponse.json(
      { report: result.report, laborCount: result.laborCount, revenueCenterCount: result.revenueCenterCount, parseWarnings: parsed.parseWarnings },
      { status: 201 },
    );
  } catch (err) {
    logger.error("Failed to upload daily ops", { route: "POST /api/daily-ops/upload", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
