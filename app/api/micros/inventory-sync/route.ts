/**
 * POST /api/micros/inventory-sync
 *
 * Triggers an inventory sync from Oracle MICROS → Supabase.
 * Fetches current menu item inventory counts and upserts into inventory_items.
 *
 * GET handler supports Vercel Cron (protected by CRON_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { syncInventoryFromMicros } from "@/services/micros/inventory/sync";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({
      ok: false,
      message: cfgStatus.enabled
        ? `Missing config: ${cfgStatus.missing.join(", ")}`
        : "MICROS integration is disabled.",
    });
  }

  let date: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    date = body.date;
  } catch {
    // no body is fine
  }

  const result = await syncInventoryFromMicros(date ?? todayISO());

  return NextResponse.json({
    ok: result.success,
    message: result.message,
    businessDate: result.businessDate,
    itemsSynced: result.itemsSynced,
    itemsCreated: result.itemsCreated,
    itemsUpdated: result.itemsUpdated,
    errors: result.errors ?? [],
    source: "manual",
    checkedAt: new Date().toISOString(),
  });
}

/** Vercel Cron sends GET requests, protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({ ok: false, message: "MICROS not configured" });
  }

  const result = await syncInventoryFromMicros(todayISO());

  return NextResponse.json({
    ok: result.success,
    message: result.message,
    businessDate: result.businessDate,
    itemsSynced: result.itemsSynced,
    source: "cron",
  });
}
