/**
 * GET /api/intelligence/cross-module
 *
 * Returns active cross-module signals for the current user's site.
 * Signals span multiple operational modules and surface compound
 * risks that no single module could detect alone.
 *
 * Response is cached for 2 minutes — signals don't need real-time freshness.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { buildOperationsContext } from "@/services/intelligence/context-builder";
import { detectSignals } from "@/services/intelligence/signal-detector";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(null, "GET /api/intelligence/cross-module");
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId = ctx.siteId;
  const date   = todayISO();

  try {
    const context = await buildOperationsContext(siteId, date);
    const signals = detectSignals(context);

    const response = NextResponse.json({
      signals,
      context,
      siteId,
      generatedAt: new Date().toISOString(),
      signalCount: signals.length,
      criticalCount: signals.filter((s) => s.severity === "CRITICAL").length,
    });

    // 2-minute client cache + 30-second stale-while-revalidate
    response.headers.set(
      "Cache-Control",
      "public, max-age=120, stale-while-revalidate=30",
    );

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to build cross-module intelligence", detail: message },
      { status: 500 },
    );
  }
}
