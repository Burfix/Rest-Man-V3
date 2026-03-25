import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createMaintenanceIssueSchema, patchMaintenanceIssueSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

function todayJHB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_MAINTENANCE, "POST /api/maintenance/issue");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createMaintenanceIssueSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .insert({
        site_id: ctx.siteId,
        equipment_id: d.equipment_id || null,
        unit_name: d.unit_name.trim(),
        category: d.category || "other",
        issue_title: d.issue_title.trim(),
        issue_description: d.issue_description?.trim() || null,
        priority: d.priority,
        impact_level: d.impact_level || "none",
        reported_by: d.reported_by?.trim() || null,
        repair_status: d.repair_status || "open",
        date_reported: d.date_reported || todayJHB(),
      })
      .select()
      .single();

    if (error) throw error;
    logger.info("Maintenance issue created", { route: "POST /api/maintenance/issue", siteId: ctx.siteId });
    return NextResponse.json({ log }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create maintenance issue", { route: "POST /api/maintenance/issue", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.UPDATE_MAINTENANCE, "PATCH /api/maintenance/issue");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchMaintenanceIssueSchema, body);
    if (!v.success) return v.response;
    const { id, ...fields } = v.data;

    const isResolved = fields.repair_status === "resolved" || fields.repair_status === "closed";
    const update: Record<string, unknown> = { ...fields };
    if (isResolved && !fields.date_fixed) {
      update.date_fixed = todayJHB();
    }

    const { data: log, error } = await supabase
      .from("maintenance_logs")
      .update(update)
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .select()
      .single();

    if (error) throw error;
    if (!log) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ log });
  } catch (err) {
    logger.error("Failed to update maintenance issue", { route: "PATCH /api/maintenance/issue", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
