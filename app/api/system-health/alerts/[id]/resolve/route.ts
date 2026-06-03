/**
 * DELETE /api/system-health/alerts/[id]/resolve
 *
 * Marks a system alert as resolved. Used by the Dismiss button in SystemAlertsPanel.
 * Accessible by: super_admin, head_office roles.
 */

import { NextResponse }        from "next/server";
import { apiGuard }            from "@/lib/auth/api-guard";
import { PERMISSIONS }         from "@/lib/rbac/roles";
import { createServerClient }  from "@/lib/supabase/server";
import { logger }              from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(
    PERMISSIONS.VIEW_SYSTEM_HEALTH as any,
    "DELETE /api/system-health/alerts/[id]/resolve",
  );
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const alertId = params.id;

  if (!alertId) {
    return NextResponse.json({ error: "Missing alert id" }, { status: 400 });
  }

  try {
    const supabase = createServerClient() as any;

    const { data, error } = await supabase.rpc("resolve_system_alert", {
      p_alert_id: alertId,
    });

    if (error) {
      logger.error("api.system-health.alerts.resolve.db-error", {
        alertId,
        siteId: ctx.siteId,
        error: error.message,
      });
      return NextResponse.json({ error: "Failed to resolve alert" }, { status: 500 });
    }

    if (!data?.success) {
      return NextResponse.json(
        { error: data?.reason ?? "Alert not found or already resolved" },
        { status: 404 },
      );
    }

    logger.info("api.system-health.alerts.resolved", {
      alertId,
      resolvedBy: ctx.userId,
      siteId:     ctx.siteId,
    });

    return NextResponse.json({ success: true, resolved_at: data.resolved_at });
  } catch (err) {
    logger.error("api.system-health.alerts.resolve.failed", {
      alertId,
      siteId: ctx.siteId,
      err:    String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
