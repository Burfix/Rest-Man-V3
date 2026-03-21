/**
 * POST /api/micros/sync
 *
 * Triggers a MICROS data sync from Oracle BIAPI → Supabase.
 * Can be called manually from the UI or by a Vercel cron.
 *
 * GET handler is for Vercel Cron (which sends GET requests).
 */

import { NextRequest, NextResponse } from "next/server";
import { MicrosSyncService } from "@/services/micros/MicrosSyncService";
import { getMicrosConfigStatus } from "@/lib/micros/config";
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

  const isCron = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

  const svc = new MicrosSyncService();
  const result = await svc.runFullSync(date ?? todayISO());

  return NextResponse.json({
    ok: result.success,
    message: result.message,
    businessDate: result.businessDate,
    recordsSynced: result.recordsSynced,
    errors: result.errors ?? [],
    source: isCron ? "cron" : "manual",
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

  const svc = new MicrosSyncService();
  const result = await svc.runFullSync(todayISO());

  return NextResponse.json({
    ok: result.success,
    message: result.message,
    businessDate: result.businessDate,
    recordsSynced: result.recordsSynced,
    source: "cron",
  });
}
