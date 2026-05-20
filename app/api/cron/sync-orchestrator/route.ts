/**
 * app/api/cron/sync-orchestrator/route.ts
 *
 * POST /api/cron/sync-orchestrator
 *
 * Thin Vercel Cron shim — delegates all work to the internal scheduler tick.
 * Authentication: Bearer CRON_SECRET  (set via Vercel Dashboard)
 *
 * The actual scheduling, enqueuing, and job execution lives in:
 *   app/api/internal/scheduler/tick/route.ts
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const dryRun  = process.env.DRY_RUN === "true" ? "?dry_run=true" : "";

  const res = await fetch(`${baseUrl}/api/internal/scheduler/tick${dryRun}`, {
    method:  "POST",
    headers: {
      authorization:  `Bearer ${cronSecret}`,
      "x-trace-id":   req.headers.get("x-trace-id") ?? crypto.randomUUID(),
      "content-type": "application/json",
    },
  });

  const body = await res.json().catch(() => ({ error: "non-json response" }));
  return NextResponse.json(body, { status: res.status });
}

// Allow GET for manual health-check pings (unauthenticated, returns nothing sensitive)
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, endpoint: "sync-orchestrator", method: "POST" });
}
