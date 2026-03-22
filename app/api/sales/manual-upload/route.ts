/**
 * POST /api/sales/manual-upload — Accept manual daily sales data
 *
 * Body: { business_date, gross_sales, covers, checks, ... }
 * Upserts into manual_sales_uploads (one row per business_date per site).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { parseManualSalesInput } from "@/lib/sales/parseManualUpload";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = parseManualSalesInput(body);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, errors: result.errors },
        { status: 400 },
      );
    }

    const { data } = result;
    const supabase = createServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("manual_sales_uploads") as any).upsert(
      {
        site_id: "00000000-0000-0000-0000-000000000001",
        business_date: data.business_date,
        gross_sales: data.gross_sales,
        net_sales: data.net_sales ?? null,
        covers: data.covers,
        checks: data.checks,
        avg_spend_per_cover: data.avg_spend_per_cover ?? null,
        avg_check_value: data.avg_check_value ?? null,
        labour_percent: data.labour_percent ?? null,
        notes: data.notes ?? null,
        source_file_name: body.source_file_name ?? null,
        uploaded_by: body.uploaded_by ?? null,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "site_id,business_date" },
    );

    if (error) {
      console.error("[manual-upload] DB error:", error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Manual sales for ${data.business_date} saved successfully`,
    });
  } catch (err) {
    console.error("[manual-upload] Unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }
}
