/**
 * POST /api/brain/action-taken
 *
 * Marks a brain signal as actioned by the current user.
 * Logs to task_accountability_log.
 *
 * Body: { signalId, actionType?, notes? }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(null, "POST /api/brain/action-taken");
  if (guard.error) return guard.error;

  const { ctx, supabase } = guard;

  const body = await req.json().catch(() => null);
  if (!body?.signalId) {
    return NextResponse.json({ error: "signalId required" }, { status: 400 });
  }

  const { signalId, actionType = "manual_acknowledgment", notes = "" } = body as {
    signalId: string;
    actionType?: string;
    notes?: string;
  };

  // Log to task_accountability_log (task_id is nullable for brain signals)
  await (supabase as any)
    .from("task_accountability_log")
    .insert({
      task_id:    null,
      actor_id:   ctx.userId,
      site_id:    ctx.siteId,
      action:     "actioned",
      notes:      `Brain signal [${actionType}]: ${signalId}. ${notes}`.trim(),
      created_at: new Date().toISOString(),
    })
    .catch(() => null); // Non-fatal — don't block response

  return NextResponse.json({
    ok:          true,
    signalId,
    actioned_by: ctx.userId,
    actioned_at: new Date().toISOString(),
  });
}
