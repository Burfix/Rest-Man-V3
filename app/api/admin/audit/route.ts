/**
 * GET /api/admin/audit — list access audit log entries
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_AUDIT_LOG, "GET /api/admin/audit");
  if (guard.error) return guard.error;
  const { supabase } = guard;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const offset = Number(searchParams.get("offset") ?? 0);

    const { data, error, count } = await supabase
      .from("access_audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error("Failed to fetch audit log", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ entries: data ?? [], total: count ?? 0 });
  } catch (err) {
    logger.error("Admin audit GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
