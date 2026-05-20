import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
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
