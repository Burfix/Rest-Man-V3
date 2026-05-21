/**
 * app/api/manager-alerts/route.ts
 *
 * GET  /api/manager-alerts  — list alerts (filtered by site, status, etc.)
 * POST /api/manager-alerts  — create a new alert; optionally send immediately
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import {
  createManagerAlert,
  listManagerAlerts,
  sendManagerAlert,
} from "@/services/alerts/manager-alert-service";

export const dynamic = "force-dynamic";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const AlertTypeValues  = ["labour","revenue","compliance","maintenance","incident","inventory","sync","custom"] as const;
const SeverityValues   = ["info","warning","critical"] as const;
const SourceValues     = ["manual","system","incident","compliance","labour","revenue","maintenance"] as const;
const StatusValues     = ["pending","sent","failed","acknowledged"] as const;

const CreateAlertSchema = z.object({
  site_id:     z.string().uuid("site_id must be a UUID"),
  manager_id:  z.string().uuid("manager_id must be a UUID"),
  alert_type:  z.enum(AlertTypeValues),
  severity:    z.enum(SeverityValues),
  source:      z.enum(SourceValues),
  title:       z.string().min(1).max(200),
  message:     z.string().min(1).max(1600),
  incident_id: z.string().uuid().optional().nullable(),
  send_now:    z.boolean().optional(),
});

const ListQuerySchema = z.object({
  site_id:    z.string().uuid().optional(),
  status:     z.enum(StatusValues).optional(),
  severity:   z.enum(SeverityValues).optional(),
  alert_type: z.enum(AlertTypeValues).optional(),
  manager_id: z.string().uuid().optional(),
  limit:      z.coerce.number().int().min(1).max(200).optional(),
  offset:     z.coerce.number().int().min(0).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "GET /api/manager-alerts");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query parameters" },
      { status: 400 },
    );
  }

  // Non-HQ roles are scoped to their own site
  const filters = parsed.data;
  const isHq    = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  if (!isHq && !filters.site_id) {
    filters.site_id = ctx.siteId;
  }

  const alerts = await listManagerAlerts(filters);
  return NextResponse.json({ alerts });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "POST /api/manager-alerts");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 },
    );
  }

  const { send_now, ...alertInput } = parsed.data;

  // Site access check: non-HQ users can only create alerts for their own site
  const isHq = ["super_admin", "executive", "head_office", "area_manager"].includes(ctx.role);
  if (!isHq && alertInput.site_id !== ctx.siteId) {
    logger.warn("manager-alerts: site_id mismatch — non-HQ user", {
      userId:         ctx.userId,
      role:           ctx.role,
      requestedSite:  alertInput.site_id,
      userSite:       ctx.siteId,
    });
    return NextResponse.json(
      { error: "You do not have permission to create alerts for this site" },
      { status: 403 },
    );
  }

  try {
    const alert = await createManagerAlert({
      ...alertInput,
      created_by: ctx.userId,
    });

    // Optionally send immediately
    if (send_now) {
      const sendResult = await sendManagerAlert(alert.id);
      return NextResponse.json({ alert, sent: sendResult });
    }

    return NextResponse.json({ alert }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("POST /api/manager-alerts failed", { error: msg, userId: ctx.userId });
    return NextResponse.json({ error: "Failed to create alert" }, { status: 500 });
  }
}
