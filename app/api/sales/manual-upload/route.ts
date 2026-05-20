import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { manualSalesSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/sales/manual-upload");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(manualSalesSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("manual_sales_uploads") as any).upsert(
      {
        site_id: ctx.siteId,
        business_date: d.business_date,
        gross_sales: d.gross_sales ?? null,
        net_sales: null,
        covers: d.covers ?? null,
        checks: d.checks ?? null,
        avg_spend_per_cover: d.avg_spend_per_cover ?? null,
        avg_check_value: d.avg_check_value ?? null,
        labour_percent: d.labour_percent ?? null,
        notes: d.notes ?? null,
        source_file_name: d.source_file_name ?? null,
        uploaded_by: ctx.email,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: "site_id,business_date" },
    );

    if (error) throw error;
    logger.info("Manual sales uploaded", { route: "POST /api/sales/manual-upload", siteId: ctx.siteId, date: d.business_date });
    return NextResponse.json({ ok: true, message: `Manual sales for ${d.business_date} saved successfully` });
  } catch (err) {
    logger.error("Failed to upload manual sales", { route: "POST /api/sales/manual-upload", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
