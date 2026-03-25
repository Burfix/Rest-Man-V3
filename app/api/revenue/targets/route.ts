import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createRevenueTargetSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { SalesTarget } from "@/types";

function todaySAST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "GET /api/revenue/targets");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const { searchParams } = req.nextUrl;
  const from = isoDate(searchParams.get("from")) ?? todaySAST();
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10)));
  const d = new Date(from + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  const to = d.toISOString().slice(0, 10);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("sales_targets") as any)
      .select("*")
      .eq("organization_id", ctx.orgId)
      .gte("target_date", from)
      .lte("target_date", to)
      .order("target_date", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ targets: (data ?? []) as SalesTarget[] });
  } catch (err) {
    logger.error("Failed to fetch revenue targets", { route: "GET /api/revenue/targets", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "POST /api/revenue/targets");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createRevenueTargetSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const payload = {
      organization_id: ctx.orgId,
      target_date: d.target_date,
      target_sales: d.target_sales ?? null,
      target_covers: d.target_covers ?? null,
      notes: d.notes ?? null,
      updated_at: new Date().toISOString(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("sales_targets") as any)
      .upsert(payload, { onConflict: "organization_id,target_date" })
      .select("*")
      .single();

    if (error) throw error;
    logger.info("Revenue target upserted", { route: "POST /api/revenue/targets", siteId: ctx.siteId });
    return NextResponse.json({ target: data as SalesTarget }, { status: 201 });
  } catch (err) {
    logger.error("Failed to upsert revenue target", { route: "POST /api/revenue/targets", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "DELETE /api/revenue/targets");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("sales_targets") as any)
      .delete()
      .eq("id", id)
      .eq("organization_id", ctx.orgId);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Failed to delete revenue target", { route: "DELETE /api/revenue/targets", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
