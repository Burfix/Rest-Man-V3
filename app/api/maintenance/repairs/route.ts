/**
 * GET  /api/maintenance/repairs?equipment_id=xxx  — list repairs for equipment
 * POST /api/maintenance/repairs                   — log a new repair
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getRepairsByEquipmentId, createRepair } from "@/services/ops/maintenanceSummary";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const equipmentId = req.nextUrl.searchParams.get("equipment_id");
  if (!equipmentId) {
    return NextResponse.json({ error: "equipment_id query param required" }, { status: 400 });
  }
  try {
    const repairs = await getRepairsByEquipmentId(equipmentId);
    return NextResponse.json({ repairs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      equipment_id,
      repair_date,
      contractor_name,
      contractor_company,
      contractor_phone,
      issue_reported,
      work_done,
      repair_cost,
      next_service_due,
      invoice_file_url,
    } = body as Record<string, unknown>;

    if (!equipment_id || typeof equipment_id !== "string") {
      return NextResponse.json({ error: "equipment_id is required" }, { status: 422 });
    }
    if (!repair_date || typeof repair_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(repair_date)) {
      return NextResponse.json({ error: "repair_date must be YYYY-MM-DD" }, { status: 422 });
    }

    // Verify equipment exists
    const supabase = createServerClient();
    const { data: equip } = await supabase
      .from("equipment")
      .select("id, unit_name")
      .eq("id", equipment_id)
      .single();
    if (!equip) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }

    const repair = await createRepair(equipment_id, {
      repair_date,
      contractor_name:    contractor_name    ? String(contractor_name).trim()    : null,
      contractor_company: contractor_company ? String(contractor_company).trim() : null,
      contractor_phone:   contractor_phone   ? String(contractor_phone).trim()   : null,
      issue_reported:     issue_reported     ? String(issue_reported).trim()     : null,
      work_done:          work_done          ? String(work_done).trim()           : null,
      repair_cost:        repair_cost != null ? Number(repair_cost)               : null,
      next_service_due:   next_service_due   ? String(next_service_due)           : null,
      invoice_file_url:   invoice_file_url   ? String(invoice_file_url)           : null,
    });

    return NextResponse.json({ repair }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
