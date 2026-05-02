/**
 * POST /api/alerts/[id]/resolve
 *
 * Marks a single operational alert as resolved.
 *
 * Response 200: { success: true }
 * Response 404: { error: "Alert not found or already resolved" }
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveAlert } from "@/services/alerts/engine";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<Response> {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "POST /api/alerts/[id]/resolve");
  if (guard.error) return guard.error;

  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: "Missing alert id" }, { status: 400 });
  }

  const ok = await resolveAlert(id);

  if (!ok) {
    return NextResponse.json(
      { error: "Alert not found or already resolved" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
