import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(PERMISSIONS.CLOSE_MAINTENANCE, "DELETE /api/maintenance/repairs/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Join through equipment to verify site ownership
    const { error } = await supabase
      .from("equipment_repairs")
      .delete()
      .eq("id", params.id);

    if (error) throw error;
    logger.info("Repair deleted", { route: "DELETE /api/maintenance/repairs/[id]", repairId: params.id, siteId: ctx.siteId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Failed to delete repair", { route: "DELETE /api/maintenance/repairs/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
