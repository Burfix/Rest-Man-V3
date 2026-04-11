/**
 * POST /api/inventory/micros-sync — Trigger MICROS Inventory sync
 * GET  /api/inventory/micros-sync — Current sync status & counts
 *
 * Requires VIEW_FINANCIALS permission (same as inventory routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  syncItemList,
  syncStockOnHand,
  syncCostCenters,
  syncVendors,
} from "@/services/inventory/micros-inventory-sync";
import type { InventorySyncType, InventorySyncResult } from "@/types/micros-inventory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── POST: trigger sync ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "POST /api/inventory/micros-sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  let body: { connectionId?: string; syncType?: InventorySyncType };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connectionId, syncType = "all" } = body;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const validTypes: InventorySyncType[] = ["items", "stock", "cost_centers", "vendors", "all"];
  if (!validTypes.includes(syncType)) {
    return NextResponse.json({ error: `Invalid syncType. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
  }

  const supabase = createServerClient() as any;

  // Verify connection exists and belongs to user's accessible sites
  const { data: conn, error: connErr } = await supabase
    .from("micros_connections")
    .select("id, site_id, inv_enabled")
    .eq("id", connectionId)
    .single();

  if (connErr || !conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  if (conn.site_id && !ctx.siteIds.includes(conn.site_id)) {
    return NextResponse.json({ error: "Not authorised for this site" }, { status: 403 });
  }

  // Create sync batch record
  const { data: batch } = await supabase
    .from("inventory_sync_batches")
    .insert({
      site_id:       conn.site_id ?? ctx.siteId,
      status:        "running",
      source:        "micros-im",
      actor_user_id: ctx.userId,
    })
    .select("id")
    .single();

  const batchId = batch?.id;

  try {
    const results: Record<string, InventorySyncResult> = {};

    if (syncType === "items" || syncType === "all") {
      results.items = await syncItemList(connectionId);
    }
    if (syncType === "cost_centers" || syncType === "all") {
      results.cost_centers = await syncCostCenters(connectionId);
    }
    if (syncType === "vendors" || syncType === "all") {
      results.vendors = await syncVendors(connectionId);
    }
    if (syncType === "stock" || syncType === "all") {
      results.stock = await syncStockOnHand(connectionId);
    }

    // Aggregate counts
    const totals = {
      fetched:  0,
      inserted: 0,
      updated:  0,
      failed:   0,
    };
    const allErrors: string[] = [];

    for (const [, r] of Object.entries(results)) {
      totals.fetched  += r.inserted + r.updated;
      totals.inserted += r.inserted;
      totals.updated  += r.updated;
      totals.failed   += r.errors.length;
      allErrors.push(...r.errors);
    }

    // Update batch record
    const batchStatus = allErrors.length === 0
      ? "success"
      : totals.inserted + totals.updated > 0
        ? "partial"
        : "error";

    if (batchId) {
      await supabase
        .from("inventory_sync_batches")
        .update({
          completed_at:   new Date().toISOString(),
          status:         batchStatus,
          fetched_count:  totals.fetched,
          inserted_count: totals.inserted,
          updated_count:  totals.updated,
          failed_count:   totals.failed,
          error_message:  allErrors.length > 0 ? allErrors.slice(0, 10).join("; ") : null,
        })
        .eq("id", batchId);
    }

    return NextResponse.json({
      ok: true,
      syncType,
      results,
      totals,
      batchId,
    });
  } catch (e: any) {
    logger.error("[MicrosInv] Sync route failed", { connectionId, syncType, error: e.message });

    if (batchId) {
      await supabase
        .from("inventory_sync_batches")
        .update({
          completed_at:  new Date().toISOString(),
          status:        "error",
          error_message: e.message?.slice(0, 500),
        })
        .eq("id", batchId);
    }

    return NextResponse.json({
      ok: false,
      error: e.message ?? "Sync failed",
      batchId,
    }, { status: 500 });
  }
}

// ── GET: sync status ────────────────────────────────────────────────────────

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_FINANCIALS, "GET /api/inventory/micros-sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const supabase = createServerClient() as any;

  // Get connection for the user's site
  const { data: conn } = await supabase
    .from("micros_connections")
    .select("id, inv_enabled, inv_last_sync_at, inv_app_server_url, inv_username")
    .eq("site_id", ctx.siteId)
    .maybeSingle();

  if (!conn) {
    return NextResponse.json({
      configured: false,
      message: "No MICROS connection for this site",
    });
  }

  // Counts
  const [itemsRes, sohRes, ccRes, vendorsRes, batchRes] = await Promise.all([
    supabase.from("inventory_items").select("id", { count: "exact", head: true })
      .eq("store_id", ctx.siteId).eq("sync_source", "micros_inventory"),
    supabase.from("micros_stock_on_hand").select("id", { count: "exact", head: true })
      .eq("site_id", ctx.siteId),
    supabase.from("micros_cost_centers").select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id),
    supabase.from("micros_vendors").select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id),
    supabase.from("inventory_sync_batches")
      .select("id, started_at, completed_at, status, fetched_count, inserted_count, updated_count, failed_count, error_message")
      .eq("site_id", ctx.siteId)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json({
    configured:       true,
    connectionId:     conn.id,
    inv_enabled:      conn.inv_enabled,
    inv_last_sync_at: conn.inv_last_sync_at,
    has_credentials:  !!conn.inv_username && !!conn.inv_app_server_url,
    counts: {
      items:        itemsRes.count ?? 0,
      stock_on_hand: sohRes.count ?? 0,
      cost_centers:  ccRes.count ?? 0,
      vendors:       vendorsRes.count ?? 0,
    },
    recent_batches: batchRes.data ?? [],
  });
}
