/**
 * GET /api/head-office/sites
 *
 * Per-site aggregate card data for the Head Office Sites overview.
 * Returns one row per accessible site with: revenue, labour, MICROS status,
 * compliance score, and health score.
 *
 * Auth: head_office / super_admin / executive / area_manager
 *
 * Response:
 *   { sites: SiteCardData[], asOf: string }
 */

import { NextResponse }       from "next/server";
import { apiGuard }           from "@/lib/auth/api-guard";
import { PERMISSIONS }        from "@/lib/rbac/roles";
import { createClient }       from "@supabase/supabase-js";
import { logger }             from "@/lib/logger";

export const dynamic = "force-dynamic";

export interface SiteCardData {
  siteId:            string;
  siteName:          string;
  storeCode:         string | null;
  // Revenue (today)
  revenueTodayNet:   number | null;
  revenueChecks:     number | null;
  revenueDate:       string | null;
  // Labour (today)
  labourHours:       number | null;
  labourTimecards:   number | null;
  labourDate:        string | null;
  // MICROS
  microsStatus:      string;          // 'connected' | 'error' | 'unknown'
  microsDataAgeMin:  number | null;
  // Compliance (last 30d pass rate)
  complianceScore:   number | null;   // 0-100
  // System health
  healthGrade:       "healthy" | "warning" | "critical" | "unknown";
  staleMins:         number | null;
  lastSyncAt:        string | null;
}

const ELEVATED = new Set(["head_office", "super_admin", "executive", "area_manager", "auditor"]);

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/head-office/sites");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!ELEVATED.has(ctx.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = serviceDb();

  try {
    // 1. Accessible site IDs
    const siteIds = ctx.siteIds.filter(Boolean);
    if (siteIds.length === 0) {
      return NextResponse.json({ sites: [], asOf: new Date().toISOString() });
    }

    // 2. Site names + health (from v_site_health_summary)
    const { data: healthRows, error: hErr } = await db
      .from("v_site_health_summary")
      .select("site_id, store_name, store_code, health, stale_minutes, last_sync_at, integration_status")
      .in("site_id", siteIds)
      .eq("is_active", true);

    if (hErr) throw new Error(`v_site_health_summary: ${hErr.message}`);

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    // 3. Revenue today (micros_sales_daily)
    const { data: salesRows } = await db
      .from("micros_sales_daily")
      .select("site_id, net_sales, check_count, business_date")
      .in("site_id", siteIds)
      .eq("business_date", today);

    // 4. Labour today (micros_labour_daily — may be named micros_timecards_daily or labour_timecards)
    const { data: labourRows } = await db
      .from("micros_labour_daily")
      .select("site_id, total_hours, timecard_count, business_date")
      .in("site_id", siteIds)
      .eq("business_date", today);

    // 5. MICROS connection health (v_micros_system_health)
    const { data: microsRows } = await db
      .from("v_micros_system_health")
      .select("site_id, connection_status, data_age_minutes")
      .in("site_id", siteIds);

    // 6. Compliance score (compliance_items — pass rate last 30d)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const { data: compRows } = await db
      .from("compliance_items")
      .select("site_id, status")
      .in("site_id", siteIds)
      .gte("created_at", thirtyDaysAgo);

    // ── Build lookup maps ────────────────────────────────────────────────────
    const salesMap   = new Map<string, { net: number; checks: number; date: string }>();
    for (const r of (salesRows ?? [])) {
      const prev = salesMap.get(r.site_id);
      const net  = (prev?.net ?? 0) + Number(r.net_sales ?? 0);
      const chk  = (prev?.checks ?? 0) + Number(r.check_count ?? 0);
      salesMap.set(r.site_id, { net, checks: chk, date: r.business_date });
    }

    const labourMap = new Map<string, { hours: number; count: number; date: string }>();
    for (const r of (labourRows ?? [])) {
      const prev  = labourMap.get(r.site_id);
      const hours = (prev?.hours ?? 0) + Number(r.total_hours ?? 0);
      const count = (prev?.count ?? 0) + Number(r.timecard_count ?? 0);
      labourMap.set(r.site_id, { hours, count, date: r.business_date });
    }

    const microsMap = new Map<string, { status: string; age: number | null }>();
    for (const r of (microsRows ?? [])) {
      // Take the best (most connected) status per site
      const prev = microsMap.get(r.site_id);
      if (!prev || r.connection_status === "connected") {
        microsMap.set(r.site_id, {
          status: r.connection_status ?? "unknown",
          age:    r.data_age_minutes != null ? Number(r.data_age_minutes) : null,
        });
      }
    }

    // Compliance: pass rate per site
    const compMap = new Map<string, { pass: number; total: number }>();
    for (const r of (compRows ?? [])) {
      const prev = compMap.get(r.site_id) ?? { pass: 0, total: 0 };
      prev.total += 1;
      if (r.status === "pass" || r.status === "compliant") prev.pass += 1;
      compMap.set(r.site_id, prev);
    }

    // ── Assemble site cards ──────────────────────────────────────────────────
    const sites: SiteCardData[] = (healthRows ?? []).map((h: any) => {
      const sales  = salesMap.get(h.site_id);
      const labour = labourMap.get(h.site_id);
      const micros = microsMap.get(h.site_id);
      const comp   = compMap.get(h.site_id);

      return {
        siteId:           h.site_id,
        siteName:         h.store_name,
        storeCode:        h.store_code ?? null,
        revenueTodayNet:  sales?.net    ?? null,
        revenueChecks:    sales?.checks ?? null,
        revenueDate:      sales?.date   ?? null,
        labourHours:      labour?.hours ?? null,
        labourTimecards:  labour?.count ?? null,
        labourDate:       labour?.date  ?? null,
        microsStatus:     micros?.status ?? "unknown",
        microsDataAgeMin: micros?.age    ?? null,
        complianceScore:  comp ? Math.round((comp.pass / comp.total) * 100) : null,
        healthGrade:      h.health ?? "unknown",
        staleMins:        h.stale_minutes ?? null,
        lastSyncAt:       h.last_sync_at  ?? null,
      } satisfies SiteCardData;
    });

    return NextResponse.json({ sites, asOf: new Date().toISOString() });
  } catch (err) {
    logger.error("GET /api/head-office/sites failed", { err });
    return NextResponse.json({ error: "Failed to load site data" }, { status: 500 });
  }
}
