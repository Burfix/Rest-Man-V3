/**
 * GET /api/system-health/micros/logs
 *
 * Returns recent micros_sync_logs for a specific connection.
 * Query params: connectionId (required), limit (default 50)
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard }                  from "@/lib/auth/api-guard";
import { PERMISSIONS }               from "@/lib/rbac/roles";
import { createServerClient }        from "@/lib/supabase/server";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/system-health/micros/logs");
  if (guard.error) return guard.error;

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  if (!connectionId) {
    return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("micros_sync_logs")
      .select("id, created_at, sync_type, business_date, status, duration_ms, sales_records, labour_records, error_message")
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ logs: data ?? [] });
  } catch (err) {
    logger.error("Failed to fetch sync logs", { connectionId, err });
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
