import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createStockMovement } from "@/services/inventory/service";
import { createInventoryMovementSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/inventory/movements");
  if (guard.error) return guard.error;

  try {
    const body = await req.json();
    const v = validateBody(createInventoryMovementSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const movement = await createStockMovement(d.inventory_item_id, d.type, d.quantity, d.note ?? undefined);
    if (!movement) {
      return NextResponse.json({ error: "Failed to create movement" }, { status: 500 });
    }
    return NextResponse.json(movement, { status: 201 });
  } catch (err) {
    logger.error("Failed to create inventory movement", { route: "POST /api/inventory/movements", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
