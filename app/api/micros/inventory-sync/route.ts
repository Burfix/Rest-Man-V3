/**
 * POST /api/micros/inventory-sync
 *
 * Triggers an inventory sync from Oracle MICROS IM → Supabase inventory_items.
 * Protected by apiGuard with SYNC_INVENTORY permission.
 *
 * GET handler supports Vercel Cron (protected by CRON_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { inventorySyncSchema, validateBody } from "@/lib/validation/schemas";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";
import { syncMicrosInventory } from "@/services/micros/inventorySync";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.SYNC_INVENTORY, "POST /api/micros/inventory-sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const logMeta = { route: "POST /api/micros/inventory-sync", requestId, userId: ctx.userId, siteId: ctx.siteId };

  try {
    const body = await req.json().catch(() => ({}));
    const v = validateBody(inventorySyncSchema, body);
    if (!v.success) return v.response;

    const { businessDate, locationCode, forceFullSync } = v.data;

    logger.info("Inventory sync requested", { ...logMeta, businessDate, locationCode, forceFullSync });

    const result = await syncMicrosInventory({
      siteId: ctx.siteId,
      businessDate: businessDate ?? todayISO(),
      locationCode,
      forceFullSync,
      actorUserId: ctx.userId,
      requestId,
    });

    const status = result.ok ? 200 : 502;
    return NextResponse.json(result, { status });
  } catch (err) {
    logger.error("Inventory sync route error", { ...logMeta, err });
    Sentry.captureException(err);
    return NextResponse.json(
      { ok: false, source: "micros-im", error: "Inventory sync failed", details: "An internal error occurred" },
      { status: 500 },
    );
  }
}

/** Vercel Cron sends GET requests, protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    // Cron jobs use the first configured MICROS connection site
    // Since cron has no user context, we use a system actor ID
    const { createServerClient } = await import("@/lib/supabase/server");
    const supabase = createServerClient();
    const { data: connection } = await (supabase as any)
      .from("micros_connections")
      .select("id, loc_ref")
      .limit(1)
      .maybeSingle();

    // For cron, resolve site from the first active sync batch or use connection context
    // In a multi-tenant setup, cron would iterate over all configured sites
    const { data: siteRow } = await (supabase as any)
      .from("inventory_items")
      .select("store_id")
      .limit(1)
      .maybeSingle();

    const siteId = siteRow?.store_id;
    if (!siteId) {
      return NextResponse.json({ ok: false, source: "micros-im", error: "No site configured for cron sync" });
    }

    const result = await syncMicrosInventory({
      siteId,
      businessDate: todayISO(),
      locationCode: connection?.loc_ref,
      actorUserId: "system:cron",
      requestId,
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error("Inventory sync cron error", { route: "GET /api/micros/inventory-sync", requestId, err });
    Sentry.captureException(err);
    return NextResponse.json(
      { ok: false, source: "micros-im", error: "Cron inventory sync failed" },
      { status: 500 },
    );
  }
}
