/**
 * POST /api/integrations/micros/sync
 *
 * Manually triggers a full sales + labour sync for a specific MICROS location.
 *
 * Request body:
 *   { "locationKey": "primi-camps-bay", "businessDate": "YYYY-MM-DD" }
 *
 * Requirements:
 *   - Admin-protected (RUN_INTEGRATION_SYNC permission)
 *   - Zod validation on request body
 *   - Server-side only — never uses NEXT_PUBLIC env vars
 *   - Syncs sales into micros_sales_daily
 *   - Syncs labour into labour_timecards + labour_daily_summary (labour_pct)
 *   - Upserts by site/location/date — safe to re-run
 *   - Updates micros_connections.last_sync_at on success
 *   - Captures errors in micros_connections.last_sync_error
 *
 * SECURITY: No credentials, tokens, or secrets are returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                         from "zod";
import * as Sentry                   from "@sentry/nextjs";
import { apiGuard }                  from "@/lib/auth/api-guard";
import { PERMISSIONS }               from "@/lib/rbac/roles";
import {
  getLocationConfig,
  isValidLocationKey,
} from "@/lib/micros/micros-location-registry";
import { runLocationSync }           from "@/services/micros/location-sync";

export const dynamic    = "force-dynamic";
export const runtime    = "nodejs";
export const maxDuration = 60;

const SyncBodySchema = z.object({
  locationKey:  z.string().refine(isValidLocationKey, {
    message: "locationKey must be one of: si-cantina, primi-camps-bay",
  }),
  businessDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "businessDate must be YYYY-MM-DD format")
    .refine((d) => !isNaN(Date.parse(d)), "businessDate must be a valid date"),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/integrations/micros/sync");
  if (guard.error) return guard.error;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SyncBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { locationKey, businessDate } = parsed.data;
  const cfg = getLocationConfig(locationKey);

  if (!cfg.enabled) {
    return NextResponse.json({
      ok: false,
      locationKey,
      error: `Location "${cfg.displayName}" integration is disabled.`,
    });
  }

  if (!cfg.configured) {
    return NextResponse.json({
      ok: false,
      locationKey,
      error: `Location "${cfg.displayName}" is not fully configured. Check environment variables.`,
    });
  }

  try {
    const result = await runLocationSync(cfg, businessDate);

    return NextResponse.json({
      ok:               result.success,
      locationKey:      result.locationKey,
      businessDate:     result.businessDate,
      message:          result.message,
      salesSynced:      result.salesSynced,
      labourSynced:     result.labourSynced,
      salesChecks:      result.salesChecks,
      labourTimecards:  result.labourTimecards,
      errors:           result.errors,
      syncedAt:         new Date().toISOString(),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { route: "POST /api/integrations/micros/sync", locationKey, businessDate },
    });
    return NextResponse.json(
      { ok: false, locationKey, businessDate, error: msg },
      { status: 500 },
    );
  }
}
