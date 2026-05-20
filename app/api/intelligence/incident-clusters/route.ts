/**
 * GET /api/intelligence/incident-clusters
 *
 * Multi-site incident correlation — the Tier-6 intelligence read model.
 *
 * Returns a CorrelationReport containing:
 *   - Incident clusters: 2+ sites same source within a 2h window
 *   - Vendor suspicion flags: clusters with 3+ distinct sites
 *   - Repeated failures: same (site_id, source) fires 3+ times in 24h
 *
 * Access: head_office | super_admin | executive | area_manager
 * Read-only — no automated actions triggered here.
 *
 * Site resolution follows the same pattern as /api/head-office/ops-center:
 *   1. Resolve visible org IDs from user_roles
 *   2. Fetch site IDs from v_site_health_summary
 *   3. Pass to correlateIncidents()
 */

import { NextResponse }                     from "next/server";
import { createClient }                     from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { correlateIncidents }               from "@/lib/intelligence/incident-correlator";
import { logger }                           from "@/lib/logger";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "head_office", "super_admin", "executive", "area_manager",
]);

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!ALLOWED.has(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    // ── Resolve visible org IDs ───────────────────────────────────────────────
    const { data: roleRows } = await db
      .from("user_roles")
      .select("organisation_id")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .in("role", Array.from(ALLOWED));

    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    const orgId = ctx.orgId ?? orgIds[0] ?? "platform";

    // ── Resolve visible site IDs ──────────────────────────────────────────────
    const siteQ = db
      .from("v_site_health_summary")
      .select("site_id")
      .eq("is_active", true);

    // super_admin sees all active sites; everyone else is scoped to their orgs.
    if (ctx.role !== "super_admin" && orgIds.length > 0) {
      siteQ.in("org_id", orgIds);
    }

    const { data: siteRows, error: siteErr } = await siteQ;

    if (siteErr) {
      logger.error("api.incident-clusters.site-query-failed", { err: siteErr.message });
      return NextResponse.json({ ok: false, error: siteErr.message }, { status: 500 });
    }

    const siteIds: string[] = ((siteRows ?? []) as any[]).map(
      (r: any) => r.site_id as string,
    );

    // ── Run deterministic correlation ─────────────────────────────────────────
    const report = await correlateIncidents(siteIds, orgId, 24);

    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    logger.error("api.incident-clusters.failed", { err: String(err) });
    return NextResponse.json(
      { ok: false, error: "Incident intelligence query failed" },
      { status: 500 },
    );
  }
}
