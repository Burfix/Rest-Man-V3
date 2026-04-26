/**
 * GET /api/head-office/risk-flags
 *
 * Returns top 10 store risk signals from v_risk_flags (migration 067).
 * Reads only from contract-layer views — no raw table queries.
 *
 * Response: { data: RiskFlagRow[], error: string | null }
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { logger } from "@/lib/logger";
import type { VRiskFlag } from "@/lib/admin/contractTypes";

export const dynamic = "force-dynamic";

const ELEVATED = ["head_office", "super_admin", "executive", "area_manager", "tenant_owner"];

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err: unknown) {
    return authErrorResponse(err);
  }

  if (!ELEVATED.includes(ctx.role ?? "")) {
    return NextResponse.json({ data: [], error: "Insufficient permissions" }, { status: 403 });
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    const isSuperAdmin = ctx.role === "super_admin";

    // Resolve this user's visible org IDs
    const { data: roleRows } = await db
      .from("user_roles")
      .select("organisation_id")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .in("role", ELEVATED);

    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    // Query v_risk_flags — severity order: critical first, then warning, then info
    const q = db
      .from("v_risk_flags")
      .select("site_id, store_name, org_id, issue_type, issue, severity, metric_value, metric_label")
      .order("severity", { ascending: true }) // critical < info < warning alphabetically — reorder in JS
      .limit(50); // fetch enough to reorder, then take top 10

    if (!isSuperAdmin && orgIds.length > 0) {
      q.in("org_id", orgIds);
    }

    const { data, error } = await q;

    if (error) {
      logger.error("Risk flags query failed", { err: error });
      return NextResponse.json({ data: [], error: error.message }, { status: 500 });
    }

    const rows = (data as VRiskFlag[] | null) ?? [];

    if (rows.length === 0 && !error) {
      logger.warn("ADMIN_API_EMPTY_DATA", {
        route: "GET /api/head-office/risk-flags",
        view: "v_risk_flags",
        orgId: ctx.orgId,
        timestamp: new Date().toISOString(),
      });
    }

    // Sort: critical → warning → info, then take top 10
    const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    const sorted = [...rows].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
    );
    const top10 = sorted.slice(0, 10);

    return NextResponse.json({ data: top10, error: null });
  } catch (err) {
    logger.error("Risk flags route failed", { err });
    return NextResponse.json({ data: [], error: "Internal server error" }, { status: 500 });
  }
}
