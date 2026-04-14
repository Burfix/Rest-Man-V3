/**
 * GET /api/head-office/site/[siteId]
 *
 * Drill-down data for a single site in the Head Office view.
 * Returns: site info, 7-day score history, today's tasks, open maintenance.
 *
 * Auth: head_office / super_admin / executive / area_manager / tenant_owner only.
 * Scoping: non-super-admin users can only access sites within their org(s).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";

export const dynamic = "force-dynamic";

const ELEVATED = ["head_office", "super_admin", "executive", "area_manager", "tenant_owner"];

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { siteId: string } },
) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  let ctx;
  try { ctx = await getUserContext(); }
  catch (err) { return authErrorResponse(err); }

  if (!ELEVATED.includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { siteId } = params;

  // Sanitise: siteId must be a UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(siteId)) {
    return NextResponse.json({ error: "Invalid site ID" }, { status: 400 });
  }

  // ── Verify access ──────────────────────────────────────────────────────────
  const { data: roleRows } = await db
    .from("user_roles")
    .select("organisation_id, site_id, role")
    .eq("user_id", ctx.userId)
    .eq("is_active", true)
    .in("role", ELEVATED);

  const isSuperAdmin = (roleRows ?? []).some((r: any) => r.role === "super_admin");

  if (!isSuperAdmin) {
    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    const { data: siteRow } = await db
      .from("sites")
      .select("id, organisation_id")
      .eq("id", siteId)
      .single();

    if (!siteRow || !orgIds.includes(siteRow.organisation_id)) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
  }

  // ── Fetch drill-down data ──────────────────────────────────────────────────
  const today    = new Date().toISOString().slice(0, 10);
  const sevenAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const [siteRes, scoresRes, tasksRes, maintRes] = await Promise.allSettled([
    db.from("sites")
      .select("id, name, site_type")
      .eq("id", siteId)
      .single(),

    db.from("manager_performance_scores")
      .select("period_date, score, tasks_assigned, tasks_completed, tasks_on_time, tasks_late")
      .eq("site_id", siteId)
      .gte("period_date", sevenAgo)
      .order("period_date", { ascending: true }),

    db.from("daily_ops_tasks")
      .select("id, action_name, status, assigned_to, due_time")
      .eq("site_id", siteId)
      .eq("task_date", today),

    db.from("maintenance_logs")
      .select("id, unit_name, priority, repair_status, date_reported")
      .eq("site_id", siteId)
      .in("repair_status", ["open", "in_progress", "awaiting_parts"]),
  ]);

  return NextResponse.json({
    site:        siteRes.status        === "fulfilled" ? siteRes.value.data         : null,
    scores:      scoresRes.status      === "fulfilled" ? (scoresRes.value.data ?? []) : [],
    tasks:       tasksRes.status       === "fulfilled" ? (tasksRes.value.data ?? [])  : [],
    maintenance: maintRes.status       === "fulfilled" ? (maintRes.value.data ?? [])  : [],
  });
}
