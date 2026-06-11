/**
 * POST /api/command-center/sync
 *
 * Single trusted endpoint for Command Center refresh.
 * Orchestrates: sales sync, labour sync, brain cache invalidation,
 * then buildCommandCenterState() — returns canonical CommandCenterSyncResponse.
 */
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { getMicrosConnectionBySiteId } from "@/services/micros/status";
import { dispatchSync } from "@/lib/sync/orchestrator";
import { runLabourDeltaSync } from "@/services/micros/labour/sync";
import { invalidateBrainCacheForSite } from "@/lib/brain/cache";
import { buildCommandCenterState } from "@/lib/command-center/build-command-center-state";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { todayISO } from "@/lib/utils";
import type { CommandCenterSyncResponse, SyncModuleResult } from "@/lib/command-center/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const t0 = Date.now();
    const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/command-center/sync");
    if (guard.error) return guard.error;
    const { ctx } = guard;

    // ── Resolve siteId ────────────────────────────────────────────────────────
    let body: Record<string, unknown> = {};
    try { body = await req.json().catch(() => ({})) as Record<string, unknown>; } catch { /* ok */ }

    const bodySiteId = body.siteId as string | undefined;
    if (bodySiteId && !ctx.siteIds.includes(bodySiteId)) {
          return NextResponse.json({ ok: false, error: "Access denied: site not in your accessible sites" }, { status: 403 });
        }
    const resolvedSiteId = bodySiteId ?? ctx.siteId;
    if (!resolvedSiteId) {
          return NextResponse.json({ ok: false, error: "siteId required — pass in body for multi-site roles" }, { status: 400 });
        }

    const warnings: string[] = [];
    const errors: string[] = [];

    // ── MICROS config check ───────────────────────────────────────────────────
    const cfgStatus = getMicrosConfigStatus();
    const microsEnabled = cfgStatus.enabled && cfgStatus.configured;
    if (!microsEnabled) warnings.push("MICROS not configured — POS data not refreshed");

    // ── Get connection ────────────────────────────────────────────────────────
    const connection = microsEnabled
      ? await getMicrosConnectionBySiteId(resolvedSiteId).catch(() => null)
      : null;

    // ── Sales + Labour sync in parallel ──────────────────────────────────────
    let salesResult: SyncModuleResult;
    let labourResult: SyncModuleResult;

    if (!microsEnabled || !connection) {
          salesResult = { ok: true, skipped: true, message: "MICROS not configured" };
          labourResult = { ok: true, skipped: true, message: "MICROS not configured" };
        } else {
          const [salesSettled, labourSettled] = await Promise.allSettled([
                  dispatchSync(
                            { loc_ref: connection.loc_ref, sync_type: "intraday_sales", mode: "delta", business_date: todayISO(), trace_id: crypto.randomUUID() },
                            resolvedSiteId,
                            crypto.randomUUID(),
                          ),
                  runLabourDeltaSync(connection.loc_ref, connection.app_server_url, connection.org_identifier, connection.location_key),
                ]);

          salesResult = salesSettled.status === "fulfilled"
            ? { ok: salesSettled.value.ok === true, message: (salesSettled.value as any).message as string | undefined, recordsAffected: (salesSettled.value as any).recordsSynced as number | undefined }
            : { ok: false, message: salesSettled.reason instanceof Error ? salesSettled.reason.message : "Sales sync failed" };

          labourResult = labourSettled.status === "fulfilled"
            ? { ok: labourSettled.value.success, message: labourSettled.value.message, recordsAffected: labourSettled.value.timecardsUpserted }
            : { ok: false, message: labourSettled.reason instanceof Error ? labourSettled.reason.message : "Labour sync failed" };

          if (!salesResult.ok) warnings.push(`Sales sync: ${salesResult.message ?? "failed"}`);
          if (!labourResult.ok) warnings.push(`Labour sync: ${labourResult.message ?? "failed"}`);
        }

    // ── Brain cache invalidation ──────────────────────────────────────────────
    let brainResult: SyncModuleResult;
    try {
          await invalidateBrainCacheForSite(resolvedSiteId);
          brainResult = { ok: true };
        } catch (e) {
          brainResult = { ok: false, message: e instanceof Error ? e.message : "Cache invalidation failed" };
          warnings.push(`Brain cache: ${brainResult.message}`);
        }

    // ── Build canonical state ─────────────────────────────────────────────────
    let stateResult: SyncModuleResult;
    let state;
    try {
          const built = await buildCommandCenterState(resolvedSiteId, ctx.orgId ?? undefined);
          state = built.state;
          stateResult = { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "State build failed";
          stateResult = { ok: false, message: msg };
          errors.push(msg);
        }

    // ── Determine sync status ─────────────────────────────────────────────────
    const syncStatus = errors.length > 0 ? "failed"
      : warnings.length > 0 ? "partial"
      : "success";

    // ── Audit log (fire-and-forget) ───────────────────────────────────────────
    try {
          const db = getServiceRoleClient() as any;
          await db.from("command_center_sync_log").insert({
                  site_id: resolvedSiteId,
                  synced_by: ctx.userId,
                  sync_status: syncStatus,
                  sales_ok: salesResult.ok,
                  labour_ok: labourResult.ok,
                  errors,
                  duration_ms: Date.now() - t0,
                });
        } catch { /* non-fatal */ }

    const response: CommandCenterSyncResponse = {
          ok: syncStatus !== "failed",
          syncStatus,
          syncedAt: new Date().toISOString(),
          siteId: resolvedSiteId,
          modules: { sales: salesResult, labour: labourResult, brain: brainResult, state: stateResult },
          state,
          warnings,
          errors,
        };

    return NextResponse.json(response, { status: syncStatus === "failed" ? 500 : 200 });
  }
