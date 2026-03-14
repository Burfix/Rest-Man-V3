/**
 * POST /api/alerts/[id]/resolve
 *
 * Marks a single operational alert as resolved.
 *
 * Response 200: { success: true }
 * Response 404: { error: "Alert not found or already resolved" }
 */

import { NextResponse } from "next/server";
import { resolveAlert } from "@/services/alerts/engine";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
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
