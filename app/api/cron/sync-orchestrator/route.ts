/**
 * app/api/cron/sync-orchestrator/route.ts
 *
 * POST /api/cron/sync-orchestrator
 *
 * 5-minute intraday sync scheduler — invoked by Vercel Cron.
 * Authenticates via HMAC, dispatches due intraday syncs and
 * backfill queue items through lib/sync/scheduler.ts.
 *
 * Safety:
 * - maxDuration: 60s (Vercel limit on hobby/pro)
 * - scheduler bails at 57s to avoid mid-write cold kill
 * - DRY_RUN=true env var skips all DB writes (shadow mode)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/sync/auth";
import { tick } from "@/lib/sync/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyCronAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  const traceId = req.headers.get("x-trace-id") ?? crypto.randomUUID();

  const result = await tick({
    invocation_source: "vercel_cron",
    trace_id: traceId,
    max_jobs_per_tick: 10,
    max_duration_ms: 57_000, // Vercel 60s limit minus 3s margin
    dry_run: process.env.DRY_RUN === "true",
  });

  return NextResponse.json(result);
}

// Allow GET for manual health-check pings (unauthenticated, returns nothing sensitive)
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, endpoint: "sync-orchestrator", method: "POST" });
}
