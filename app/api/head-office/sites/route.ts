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

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/head-office/sites");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  if (!ELEVATED.has(ctx.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

    // 1. Accessible site IDs
    const siteIds = ctx.siteIds.filter(Boolean);
    if (siteIds.length === 0) {
      return NextResponse.json({ sites: [], asOf: new Date().toISOString() });
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    // 2. Site base rows — primary source is v_site_health_summary; fall back to sites table
    type HealthRow = {
      site_id: string;
      store_name: string;
      store_code: string | null;
      health: "healthy" | "warning" | "critical" | "unknown";
      stale_minutes: number | null;
      last_sync_at: string | null;
      integration_status: string;
    };

    let baseRows: HealthRow[] = [];

    const { data: healthRows, error: hErr } = await db
      .from("v_site_health_summary")
      .select("site_id, store_name, store_code, health, stale_minutes, last_sync_at, integration_status")
      .in("site_id", siteIds)
      .eq("is_active", true);

    if (hErr) {
      // Log the real error server-side for Vercel diagnostics, then fall back gracefully
      console.error("[HEAD_OFFICE_SITES] v_site_health_summary failed:", JSON.stringify(hErr));
      logger.error("[HEAD_OFFICE_SITES] v_site_health_summary failed", { hErr });

      // Fall back: query sites table directly (no health data)
      const { data: siteRows, error: sErr } = await db
        .from("sites")
        .select("id, name, store_code")
        .in("id", siteIds)
        .eq("is_active", true);

      if (sErr) {
        console.error("[HEAD_OFFICE_SITES] sites fallback also failed:", JSON.stringify(sErr));
        return NextResponse.json({ error: "Failed to load site data" }, { status: 500 });
      }

      baseRows = ((siteRows ?? []) as any[]).map((s: any): HealthRow => ({
        site_id:            s.id,
        store_name:         s.name,
        store_code:         s.store_code ?? null,
        health:             "unknown",
        stale_minutes:      null,
        last_sync_at:       null,
        integration_status: "none",
      }));
    } else {
      baseRows = (healthRows ?? []) as HealthRow[];
    }

    // 3. Revenue today (micros_sales_daily — site_id added via migration 083)
    const { data: salesRows, error: salesErr } = await db
      .from("micros_sales_daily")
      .select("site_id, net_sales, check_count, business_date")
      .in("site_id", siteIds)
      .eq("business_date", today);
    if (salesErr) console.error("[HEAD_OFFICE_SITES] micros_sales_daily failed:", JSON.stringify(salesErr));

    // 4. Labour today (labour_daily_summary keyed by loc_ref; join via micros_connections)
    const { data: connRows, error: connErr } = await db
      .from("micros_connections")
      .select("site_id, loc_ref")
      .in("site_id", siteIds);
    if (connErr) console.error("[HEAD_OFFICE_SITES] micros_connections failed:", JSON.stringify(connErr));

    const siteToLocRef = new Map<string, string>();
    const locRefToSite = new Map<string, string>();
    for (const c of (connRows ?? []) as any[]) {
      if (c.site_id && c.loc_ref) {
        siteToLocRef.set(c.site_id, c.loc_ref);
        locRefToSite.set(c.loc_ref, c.site_id);
      }
    }

    const locRefs = Array.from(siteToLocRef.values());
    let labourRows: any[] = [];
    if (locRefs.length > 0) {
      const { data: lr, error: lErr } = await db
        .from("labour_daily_summary")
        .select("loc_ref, total_hours, active_staff_count, business_date")
        .in("loc_ref", locRefs)
        .eq("business_date", today);
      if (lErr) console.error("[HEAD_OFFICE_SITES] labour_daily_summary failed:", JSON.stringify(lErr));
      labourRows = lr ?? [];
    }

    // 5. MICROS connection health (v_micros_system_health — added migration 085)
    const { data: microsRows, error: microsErr } = await db
      .from("v_micros_system_health")
      .select("site_id, connection_status, data_age_minutes")
      .in("site_id", siteIds);
    if (microsErr) console.error("[HEAD_OFFICE_SITES] v_micros_system_health failed:", JSON.stringify(microsErr));

    // 6. Compliance score (compliance_items — site_id added via migration 083)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const { data: compRows, error: compErr } = await db
      .from("compliance_items")
      .select("site_id, status")
      .in("site_id", siteIds)
      .gte("created_at", thirtyDaysAgo);
    if (compErr) console.error("[HEAD_OFFICE_SITES] compliance_items failed:", JSON.stringify(compErr));

    // ── Build lookup maps ────────────────────────────────────────────────────
    const salesMap = new Map<string, { net: number; checks: number; date: string }>();
    for (const r of (salesRows ?? []) as any[]) {
      if (!r.site_id) continue;
      const prev = salesMap.get(r.site_id);
      salesMap.set(r.site_id, {
        net:    (prev?.net ?? 0) + Number(r.net_sales ?? 0),
        checks: (prev?.checks ?? 0) + Number(r.check_count ?? 0),
        date:   r.business_date,
      });
    }

    const labourMap = new Map<string, { hours: number; count: number; date: string }>();
    for (const r of labourRows) {
      const sid = locRefToSite.get(r.loc_ref);
      if (!sid) continue;
      const prev = labourMap.get(sid);
      labourMap.set(sid, {
        hours: (prev?.hours ?? 0) + Number(r.total_hours ?? 0),
        count: (prev?.count ?? 0) + Number(r.active_staff_count ?? 0),
        date:  r.business_date,
      });
    }

    const microsMap = new Map<string, { status: string; age: number | null }>();
    for (const r of (microsRows ?? []) as any[]) {
      if (!r.site_id) continue;
      const prev = microsMap.get(r.site_id);
      if (!prev || r.connection_status === "connected") {
        microsMap.set(r.site_id, {
          status: r.connection_status ?? "unknown",
          age:    r.data_age_minutes != null ? Number(r.data_age_minutes) : null,
        });
      }
    }

    const compMap = new Map<string, { pass: number; total: number }>();
    for (const r of (compRows ?? []) as any[]) {
      if (!r.site_id) continue;
      const prev = compMap.get(r.site_id) ?? { pass: 0, total: 0 };
      prev.total += 1;
      if (r.status === "pass" || r.status === "compliant") prev.pass += 1;
      compMap.set(r.site_id, prev);
    }

    // ── Assemble site cards ──────────────────────────────────────────────────
    const sites: SiteCardData[] = baseRows.map((h) => {
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
        microsStatus:     micros?.status ?? h.integration_status ?? "unknown",
        microsDataAgeMin: micros?.age    ?? null,
        complianceScore:  comp ? Math.round((comp.pass / comp.total) * 100) : null,
        healthGrade:      h.health ?? "unknown",
        staleMins:        h.stale_minutes ?? null,
        lastSyncAt:       h.last_sync_at  ?? null,
      } satisfies SiteCardData;
    });

    return NextResponse.json({ sites, asOf: new Date().toISOString() });
  } catch (err) {
    console.error("[HEAD_OFFICE_SITES] Unhandled error:", err);
    logger.error("GET /api/head-office/sites failed", { err });
    return NextResponse.json({ error: "Failed to load site data" }, { status: 500 });
  }
}
