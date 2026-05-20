/**
 * POST /api/incidents/[id]/assign
 *
 * Assign an incident to a specific user.
 *
 * Behavior:
 *   - Sets assigned_to = payload.userId.
 *   - Does not validate that the target user exists or has access to the site
 *     (assignment is an intent signal; access is enforced at the source).
 *
 * Body: { userId: string }  — must be a valid UUID
 * Access: see lib/incidents/guard.ts — ALL_WRITE_ROLES
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import { guardIncidentWrite }        from "@/lib/incidents/guard";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

const AssignSchema = z.object({
  userId: z.string().uuid({ message: "userId must be a valid UUID" }),
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

  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const { error } = await db
    .from("system_incidents")
    .update({
      assigned_to: parsed.data.userId,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", incident.id);

  if (error) {
    logger.error("api.incidents.assign_failed", {
      id:  incident.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: "Failed to assign incident" },
      { status: 500 },
    );
  }

  logger.info("api.incidents.assigned", {
    id: incident.id,
    to: parsed.data.userId,
    by: ctx.userId,
  });
  return NextResponse.json({ ok: true });
}
