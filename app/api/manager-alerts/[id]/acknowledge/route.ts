/**
 * app/api/manager-alerts/[id]/acknowledge/route.ts
 *
 * POST /api/manager-alerts/[id]/acknowledge
 *
 * Mark a sent or pending alert as acknowledged by the current user.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { acknowledgeAlert } from "@/services/alerts/manager-alert-service";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "POST /api/manager-alerts/[id]/acknowledge");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const alertId = params.id;
  if (!alertId?.match(/^[0-9a-f-]{36}$/i)) {
    return NextResponse.json({ error: "Invalid alert ID" }, { status: 400 });
  }

  // Site access check
  const db = createServerClient();
  const { data: alert } = await db
    .from("manager_alerts")
    .select("id, site_id, status")
    .eq("id", alertId)
    .single();

  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  if (!isHq && alert.site_id !== ctx.siteId) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (alert.status === "acknowledged") {
    return NextResponse.json({ ok: true, already: true });
  }

  const result = await acknowledgeAlert(alertId, ctx.userId);

  if (!result.ok) {
    logger.error("POST /api/manager-alerts/[id]/acknowledge failed", {
      alertId,
      error: result.error,
      userId: ctx.userId,
    });
    return NextResponse.json({ error: result.error ?? "Failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
