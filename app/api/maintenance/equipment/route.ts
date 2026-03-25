import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createEquipmentSchema, patchEquipmentSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_MAINTENANCE, "POST /api/maintenance/equipment");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createEquipmentSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data: equipment, error } = await supabase
      .from("equipment")
      .insert({
        site_id: ctx.siteId,
        unit_name: d.unit_name.trim(),
        category: d.category,
        location: d.location?.trim() || null,
        status: d.status || "operational",
        notes: d.notes?.trim() || null,
        serial_number: d.serial_number?.trim() || null,
        supplier: d.supplier?.trim() || null,
        purchase_date: d.purchase_date || null,
        warranty_expiry: d.warranty_expiry || null,
      })
      .select()
      .single();

    if (error) throw error;
    logger.info("Equipment created", { route: "POST /api/maintenance/equipment", siteId: ctx.siteId });
    return NextResponse.json({ equipment }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create equipment", { route: "POST /api/maintenance/equipment", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.UPDATE_MAINTENANCE, "PATCH /api/maintenance/equipment");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchEquipmentSchema, body);
    if (!v.success) return v.response;
    const { id, ...fields } = v.data;

    const { data, error } = await supabase
      .from("equipment")
      .update(fields as any)
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ equipment: data });
  } catch (err) {
    logger.error("Failed to update equipment", { route: "PATCH /api/maintenance/equipment", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
