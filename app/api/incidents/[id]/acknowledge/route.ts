/**
 * POST /api/incidents/[id]/acknowledge
 *
 * Mark an incident as acknowledged by the current user.
 *
 * Behavior:
 *   - Sets acknowledged_at and acknowledged_by unconditionally.
 *   - Advances status from 'open' → 'acknowledged'.
 *     If status is already 'investigating' or 'resolved', status is not changed
 *     (acknowledgment is recorded without downgrading the lifecycle).
 *
 * Access: see lib/incidents/guard.ts — ALL_WRITE_ROLES
 * No body required.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardIncidentWrite }        from "@/lib/incidents/guard";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await guardIncidentWrite(params.id);
  if (guard instanceof Response) return guard;
  const { ctx, incident, db } = guard;

  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    acknowledged_at: now,
    acknowledged_by: ctx.userId,
    updated_at:      now,
  };

  // Only advance status when it is currently 'open' — do not downgrade
  // an already-investigating or resolved incident.
  if (incident.status === "open") {
    update.status = "acknowledged";
  }

  const { error } = await db
    .from("system_incidents")
    .update(update)
    .eq("id", incident.id);

  if (error) {
    logger.error("api.incidents.acknowledge_failed", {
      id:  incident.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: "Failed to acknowledge incident" },
      { status: 500 },
    );
  }

  logger.info("api.incidents.acknowledged", { id: incident.id, by: ctx.userId });
  return NextResponse.json({ ok: true });
}
