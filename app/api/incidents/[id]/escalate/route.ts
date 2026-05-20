/**
 * POST /api/incidents/[id]/escalate
 *
 * Set the escalation level of an incident.
 *
 * Behavior:
 *   - Updates escalation_level to the requested value.
 *   - Does NOT change status (escalation is orthogonal to lifecycle).
 *   - Allows any level: normal | elevated | urgent
 *     (de-escalation is a valid operational action).
 *
 * Body: { escalationLevel: "normal" | "elevated" | "urgent" }
 * Access: see lib/incidents/guard.ts — ALL_WRITE_ROLES
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import { guardIncidentWrite }        from "@/lib/incidents/guard";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

const EscalateSchema = z.object({
  escalationLevel: z.enum(["normal", "elevated", "urgent"], {
    errorMap: () => ({ message: "escalationLevel must be normal | elevated | urgent" }),
  }),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await guardIncidentWrite(params.id);
  if (guard instanceof Response) return guard;
  const { ctx, incident, db } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EscalateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const { error } = await db
    .from("system_incidents")
    .update({
      escalation_level: parsed.data.escalationLevel,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", incident.id);

  if (error) {
    logger.error("api.incidents.escalate_failed", {
      id:  incident.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: "Failed to update escalation level" },
      { status: 500 },
    );
  }

  logger.info("api.incidents.escalated", {
    id:    incident.id,
    level: parsed.data.escalationLevel,
    by:    ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
