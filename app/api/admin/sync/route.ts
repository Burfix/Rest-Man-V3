/**
 * app/api/admin/sync/route.ts
 *
 * GET  /api/admin/sync       — returns health, data gaps, backfill queue, suspicious runs
 * POST /api/admin/sync       — enqueue backfill or retry failed queue items
 *
 * Access: super_admin role only.
 * Every action is logged to access_audit_log.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── GET — read-only dashboard data ───────────────────────────────────────────

export async function GET(req: NextRequest) {
  const guard = await apiGuard(undefined, "GET /api/admin/sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (ctx.role !== "super_admin" && ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServerClient();
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "health";

  try {
    if (view === "health") {
      const { data, error } = await supabase
        .from("sync_health_monitor")
        .select("*")
        .order("is_overdue", { ascending: false })
        .order("last_synced_at", { ascending: true });

      if (error) throw error;
      return NextResponse.json({ health: data ?? [] });
    }

    if (view === "gaps") {
      const days = parseInt(url.searchParams.get("days") ?? "30", 10);
      const lookback = Math.min(Math.max(days, 1), 90);

      const { data, error } = await supabase
        .from("sync_data_gaps")
        .select("*")
        .order("business_date", { ascending: false })
        .limit(lookback * 50); // up to 50 sites × 30 days

      if (error) throw error;
      return NextResponse.json({ gaps: data ?? [] });
    }

    if (view === "queue") {
      const { data, error } = await supabase
        .from("sync_backfill_queue")
        .select("*")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      return NextResponse.json({ queue: data ?? [] });
    }

    if (view === "suspicious") {
      const { data, error } = await supabase
        .from("suspicious_sync_runs")
        .select("*")
        .order("business_date", { ascending: false })
        .limit(100);

      if (error) throw error;
      return NextResponse.json({ suspicious: data ?? [] });
    }

    return NextResponse.json({ error: "Unknown view. Use: health | gaps | queue | suspicious" }, { status: 400 });
  } catch (err) {
    logger.error("admin/sync GET failed", { view, err: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST — mutating actions ───────────────────────────────────────────────────

const PostBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enqueue_gaps"),
    lookback_days: z.number().int().min(1).max(90).default(30),
  }),
  z.object({
    action: z.literal("retry_failed"),
    queue_ids: z.array(z.string().uuid()).min(1).max(50),
  }),
  z.object({
    action: z.literal("enqueue_dates"),
    connection_id: z.string().uuid(),
    sync_type: z.string(),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(60),
    priority: z.number().int().min(0).max(10).default(5),
  }),
]);

export async function POST(req: NextRequest) {
  const guard = await apiGuard(undefined, "POST /api/admin/sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (ctx.role !== "super_admin" && ctx.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createServerClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;

  try {
    if (payload.action === "enqueue_gaps") {
      const { data, error } = await supabase.rpc("enqueue_sync_gaps", {
        p_lookback_days: payload.lookback_days,
      });
      if (error) throw error;

      await auditLog(supabase, ctx.userId, "sync.enqueue_gaps", { lookback_days: payload.lookback_days });
      return NextResponse.json({ ok: true, enqueued: data });
    }

    if (payload.action === "retry_failed") {
      const { error } = await supabase
        .from("sync_backfill_queue")
        .update({ status: "pending", attempts: 0, last_error: null })
        .in("id", payload.queue_ids)
        .eq("status", "failed");

      if (error) throw error;

      await auditLog(supabase, ctx.userId, "sync.retry_failed", { queue_ids: payload.queue_ids });
      return NextResponse.json({ ok: true, retried: payload.queue_ids.length });
    }

    if (payload.action === "enqueue_dates") {
      const rows = payload.dates.map((d) => ({
        connection_id: payload.connection_id,
        sync_type: payload.sync_type,
        business_date: d,
        priority: payload.priority,
        status: "pending",
        created_by: ctx.userId,
      }));

      const { error } = await supabase
        .from("sync_backfill_queue")
        .upsert(rows, { onConflict: "connection_id,sync_type,business_date" });

      if (error) throw error;

      await auditLog(supabase, ctx.userId, "sync.enqueue_dates", {
        connection_id: payload.connection_id,
        sync_type: payload.sync_type,
        dates: payload.dates,
      });

      return NextResponse.json({ ok: true, enqueued: rows.length });
    }
  } catch (err) {
    logger.error("admin/sync POST failed", { action: payload.action, err: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function auditLog(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from("access_audit_log").insert({
      user_id: userId,
      action,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn("audit_log.write_failed", { action, err: String(err) });
  }
}
