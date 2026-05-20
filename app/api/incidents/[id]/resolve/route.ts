/**
 * POST /api/incidents/[id]/resolve
 *
 * Mark an incident as resolved.
 *
 * Behavior:
 *   - Sets status = 'resolved', resolved_at = now(), resolved_by = caller.
 *   - Idempotent: already-resolved incidents return { ok: true } immediately.
 *   - Optional notes: if body.notes is provided, also sets operator_notes.
 *
 * Body: { notes?: string }  — optional, max 2000 chars
 * Access: see lib/incidents/guard.ts — ALL_WRITE_ROLES
 *
 * This route supersedes /api/system-health/incidents/[id]/resolve, adding
 * resolved_by tracking and optional notes in a single atomic update.
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import { guardIncidentWrite }        from "@/lib/incidents/guard";
import { logger }                    from "@/lib/logger";

export const dynamic = "force-dynamic";

const ResolveSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await guardIncidentWrite(params.id);
  if (guard instanceof Response) return guard;
  const { ctx, incident, db } = guard;

  // Idempotent — already resolved incidents are a no-op
  if (incident.status === "resolved") {
    return NextResponse.json({ ok: true });
  }

  // Body is optional — parse gracefully
  let notes: string | undefined;
  try {
    const raw = await req.json();
    const parsed = ResolveSchema.safeParse(raw);
    if (parsed.success) notes = parsed.data.notes;
  } catch {
    // No body provided — proceed without notes
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status:      "resolved",
    resolved_at: now,
    resolved_by: ctx.userId,
    updated_at:  now,
  };
  if (notes) update.operator_notes = notes;

  const { error } = await db
    .from("system_incidents")
    .update(update)
    .eq("id", incident.id);

  if (error) {
    logger.error("api.incidents.resolve_failed", {
      id:  incident.id,
      err: error.message,
    });
    return NextResponse.json(
      { error: "Failed to resolve incident" },
      { status: 500 },
    );
  }

  logger.info("api.incidents.resolved", { id: incident.id, by: ctx.userId });
  return NextResponse.json({ ok: true });
}
