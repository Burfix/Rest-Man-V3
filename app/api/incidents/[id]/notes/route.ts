/**
 * PATCH /api/incidents/[id]/notes
 *
 * Append or replace operator notes on an incident.
 *
 * Behavior:
 *   - Sets operator_notes = payload.notes (full replace, not append).
 *     The client is responsible for building the full notes string if
 *     it wants to preserve history (append to existing before sending).
 *   - Works for any status — operators can add notes to open, acknowledged,
 *     investigating, or resolved incidents.
 *
 * Body: { notes: string }  — required, max 2000 chars
 * Access: see lib/incidents/guard.ts — ALL_WRITE_ROLES
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import { guardIncidentWrite }        from "@/lib/incidents/guard";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

const NotesSchema = z.object({
  notes: z.string().min(1, "notes must not be empty").max(2000, "notes too long"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await guardIncidentWrite(params.id);
  if (guard instanceof NextResponse) return guard;
  const { ctx, incident, db } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = NotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const { error } = await db
    .from("system_incidents")
    .update({
      operator_notes: parsed.data.notes,
      updated_at:     new Date().toISOString(),
    })
    .eq("id", incident.id);

  if (error) {
    logger.error("api.incidents.notes_failed", {
      id:  incident.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: "Failed to update notes" },
      { status: 500 },
    );
  }

  logger.info("api.incidents.notes_updated", { id: incident.id, by: ctx.userId });
  return NextResponse.json({ ok: true });
}
