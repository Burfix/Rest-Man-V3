/**
 * POST /api/sync/run
 *
 * Manual sync trigger — runs the V2 sync engine for a given type/site.
 *
 * Body: { syncType: "sales"|"labour"|"inventory", date?: string, idempotencyKey?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { runSync, microsSalesAdapter, microsLabourAdapter } from "@/lib/sync";
import { todayISO } from "@/lib/utils";
import type { SyncType, SyncConfig, SourceAdapter, RawRecord } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Adapter registry
const adapters: Record<string, SourceAdapter<RawRecord>> = {
  sales: microsSalesAdapter,
  labour: microsLabourAdapter,
};

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/sync/run");
  if (guard.error) return guard.error;

  let body: { syncType?: string; date?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const syncType = body.syncType as SyncType | undefined;
  if (!syncType || !adapters[syncType]) {
    return NextResponse.json(
      { ok: false, error: `Invalid syncType. Supported: ${Object.keys(adapters).join(", ")}` },
      { status: 400 },
    );
  }

  const siteId = guard.ctx!.siteId;
  if (!siteId) {
    return NextResponse.json({ ok: false, error: "No site context" }, { status: 400 });
  }

  const config: SyncConfig = {
    siteId,
    syncType,
    source: "micros",
    trigger: "manual",
    businessDate: body.date ?? todayISO(),
    idempotencyKey: body.idempotencyKey,
    metadata: { userId: guard.ctx!.userId },
  };

  try {
    const result = await runSync(adapters[syncType], config);

    logger.info("Sync run completed", {
      route: "POST /api/sync/run",
      runId: result.runId,
      status: result.status,
      syncType,
      siteId,
    });

    return NextResponse.json({
      ok: result.status === "success" || result.status === "partial",
      runId: result.runId,
      status: result.status,
      syncType: result.syncType,
      trigger: result.trigger,
      recordsFetched: result.recordsFetched,
      recordsWritten: result.recordsWritten,
      recordsSkipped: result.recordsSkipped,
      recordsErrored: result.recordsErrored,
      durationMs: result.durationMs,
      checkpointValue: result.checkpointValue,
      errors: result.errors.map((e) => ({
        phase: e.phase,
        message: e.message,
        retryable: e.retryable,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Sync run crashed", { route: "POST /api/sync/run", syncType, siteId, err });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
