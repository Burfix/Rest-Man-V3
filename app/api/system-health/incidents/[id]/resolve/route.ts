/**
 * POST /api/system-health/incidents/[id]/resolve
 *
 * Mark a system incident as resolved.
 * Sets status='resolved' and resolved_at=now().
 *
 * Permission: manage_system_health
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(
    PERMISSIONS.MANAGE_SYSTEM_HEALTH as any,
    "POST /api/system-health/incidents/[id]/resolve",
  );
  if (guard.error) return guard.error;

  const { ctx, supabase } = guard;
  const incidentId = params.id;

  if (!incidentId || !/^[0-9a-f-]{36}$/.test(incidentId)) {
    return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
  }

  try {
    const { error } = await (supabase as any)
      .from("system_incidents")
      .update({
        status:      "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", incidentId);

    if (error) throw error;

    logger.info("system.health.incident.resolved", {
      incidentId,
      resolvedBy: ctx.userId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("system.health.incident.resolve_failed", { incidentId, err: String(err) });
    Sentry.captureException(err, {
      tags:  { route: "POST /api/system-health/incidents/[id]/resolve" },
      extra: { incidentId },
    });
    return NextResponse.json({ error: "Failed to resolve incident" }, { status: 500 });
  }
}
