/**
 * app/api/manager-alerts/[id]/send/route.ts
 *
 * POST /api/manager-alerts/[id]/send
 *
 * Trigger WhatsApp delivery for a pending or failed alert.
 * Pass force=true in body to bypass the 30-minute dedup window (e.g. for retries).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { sendManagerAlert } from "@/services/alerts/manager-alert-service";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  force: z.boolean().optional(),
}).optional();

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "POST /api/manager-alerts/[id]/send");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const alertId = params.id;
  if (!alertId?.match(/^[0-9a-f-]{36}$/i)) {
    return NextResponse.json({ error: "Invalid alert ID" }, { status: 400 });
  }

  // Parse optional body
  let force = false;
  try {
    const rawBody = await req.text();
    if (rawBody.trim()) {
      const parsed = BodySchema.safeParse(JSON.parse(rawBody));
      force = parsed.success ? (parsed.data?.force ?? false) : false;
    }
  } catch {
    // empty body is fine
  }

  // Site access check: verify caller can access the alert's site
  const db = createServerClient();
  const { data: alert } = await db
    .from("manager_alerts")
    .select("id, site_id, status")
    .eq("id", alertId)
    .single();

  if (!alert) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  if (!isHq && alert.site_id !== ctx.siteId) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (alert.status === "acknowledged") {
    return NextResponse.json(
      { error: "Alert is already acknowledged — resend not permitted" },
      { status: 409 },
    );
  }

  // If force=true, bump retry_count so dedup check is bypassed in service layer
  if (force && alert.status === "sent") {
    await db
      .from("manager_alerts")
      .update({ status: "pending", retry_count: 1 })
      .eq("id", alertId);
  }

  const result = await sendManagerAlert(alertId);

  if (result.skipped) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: result.reason },
      { status: 409 },
    );
  }

  if (!result.ok) {
    logger.error("POST /api/manager-alerts/[id]/send delivery failed", {
      alertId,
      error: result.error,
      userId: ctx.userId,
    });
    return NextResponse.json(
      { ok: false, error: result.error ?? "Delivery failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, messageId: result.messageId });
}
