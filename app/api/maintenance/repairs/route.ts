import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createRepairSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getRepairsByEquipmentId, createRepair } from "@/services/ops/maintenanceSummary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/maintenance/repairs");
  if (guard.error) return guard.error;

  const equipmentId = req.nextUrl.searchParams.get("equipment_id");
  if (!equipmentId) {
    return NextResponse.json({ error: "equipment_id query param required" }, { status: 400 });
  }

  try {
    const repairs = await getRepairsByEquipmentId(equipmentId);
    return NextResponse.json({ repairs });
  } catch (err) {
    logger.error("Failed to fetch repairs", { route: "GET /api/maintenance/repairs", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_MAINTENANCE, "POST /api/maintenance/repairs");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createRepairSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // Verify equipment exists and belongs to this site
    const { data: equip } = await supabase
      .from("equipment")
      .select("id")
      .eq("id", d.equipment_id)
      .eq("site_id", ctx.siteId)
      .single();
    if (!equip) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }

    const repair = await createRepair(d.equipment_id, {
      repair_date: d.repair_date,
      contractor_name: d.contractor_name ?? null,
      contractor_company: d.contractor_company ?? null,
      contractor_phone: d.contractor_phone ?? null,
      issue_reported: d.issue_reported ?? null,
      work_done: d.work_done ?? null,
      repair_cost: d.repair_cost ?? null,
      next_service_due: d.next_service_due ?? null,
      invoice_file_url: d.invoice_file_url ?? null,
    });

    logger.info("Repair created", { route: "POST /api/maintenance/repairs", siteId: ctx.siteId });
    return NextResponse.json({ repair }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create repair", { route: "POST /api/maintenance/repairs", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
