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

import { NextResponse }          from "next/server";
import { apiGuard }              from "@/lib/auth/api-guard";
import { PERMISSIONS }           from "@/lib/rbac/roles";
import { createClient }          from "@supabase/supabase-js";
import { logger }                from "@/lib/logger";
import { scoreSite }             from "@/lib/head-office/site-health";
import { applySandboxMirror }    from "@/lib/demo/getSandboxData";

export const dynamic = "force-dynamic";

// Si Cantina Sociale — primary live reference site used for sandbox mirroring
const SI_CANTINA_SITE_IDS = new Set([
  "00000000-0000-0000-0000-000000000001",  // original Si Cantina Sociale
  "00000000-0000-0000-0000-000000000002",  // Si Cantina (TENANT_ISOLATION_AUDIT)
]);
const SI_CANTINA_STORE_CODES = new Set(["SCS", "SC-CB", "SC-SOC"]);

export interface SiteCardData {
  siteId:              string;
  siteName:            string;
  storeCode:           string | null;
  // Revenue (today)
  revenueTodayNet:     number | null;
  revenueChecks:       number | null;  // check count
  guestCount:          number | null;  // covers
  revenueDate:         string | null;
  // Labour (today)
  labourHours:         number | null;
  labourTimecards:     number | null;
  labourDate:          string | null;
  // MICROS
  microsStatus:        string;         // 'connected' | 'syncing' | 'stale' | 'error' | 'unknown'
  microsDataAgeMin:    number | null;
  // Compliance
  complianceScore:     number | null;  // 0–100 pass rate
  complianceDueSoon:   number | null;  // items due in ≤30 days
  complianceOverdue:   number | null;  // overdue items
  // System health (computed by scoring engine)
  healthGrade:         "healthy" | "warning" | "critical" | "unknown";
  healthScore:         number;
  staleMins:           number | null;
  lastSyncAt:          string | null;
  // Demo / sandbox
  isDemoData:          boolean;
  mirroredFrom:        string | null;
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

    // ── 1. Accessible site IDs ──────────────────────────────────────────────
    const siteIds = ctx.siteIds.filter(Boolean);
    if (siteIds.length === 0) {
      return NextResponse.json({ sites: [], asOf: new Date().toISOString() });
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    // ── 2. Site base rows — primary source: v_site_health_summary
    //       Fallback to sites table if view errors. ────────────────────────
    type BaseRow = {
      site_id:            string;
      store_name:         string;
      store_code:         string | null;
      health:             "healthy" | "warning" | "critical" | "unknown";
      stale_minutes:      number | null;
      last_sync_at:       string | null;
      integration_status: string;
    };

    let baseRows: BaseRow[] = [];

    const { data: healthRows, error: hErr } = await db
      .from("v_site_health_summary")
      .select("site_id, store_name, store_code, health, stale_minutes, last_sync_at, integration_status")
      .in("site_id", siteIds)
      .eq("is_active", true);

    if (hErr) {
      console.error("[HEAD_OFFICE_SITES] v_site_health_summary failed:", JSON.stringify(hErr));
      // Fallback to sites table
      const { data: siteRows, error: sErr } = await db
        .from("sites")
        .select("id, name, store_code")
        .in("id", siteIds)
        .eq("is_active", true);

      if (sErr) {
        console.error("[HEAD_OFFICE_SITES] sites fallback also failed:", JSON.stringify(sErr));
        return NextResponse.json({ error: "Failed to load site data" }, { status: 500 });
      }

      baseRows = ((siteRows ?? []) as any[]).map((s: any): BaseRow => ({
        site_id:            s.id,
        store_name:         s.name,
        store_code:         s.store_code ?? null,
        health:             "unknown",
        stale_minutes:      null,
        last_sync_at:       null,
        integration_status: "none",
      }));
    } else {
      baseRows = (healthRows ?? []) as BaseRow[];
    }

    // ── 3. micros_connections — loc_ref / site_id bridge + conn status ──────
    const { data: connRows, error: connErr } = await db
      .from("micros_connections")
      .select("id, site_id, loc_ref, status, last_successful_sync_at")
      .in("site_id", siteIds);
    if (connErr) console.error("[HEAD_OFFICE_SITES] micros_connections failed:", JSON.stringify(connErr));

    const siteToLocRef  = new Map<string, string>();
    const locRefToSite  = new Map<string, string>();
    const siteConnStatus = new Map<string, string>();
    const siteSyncAt    = new Map<string, string>();

    for (const c of (connRows ?? []) as any[]) {
      if (c.site_id && c.loc_ref) {
        siteToLocRef.set(c.site_id, c.loc_ref);
        locRefToSite.set(c.loc_ref, c.site_id);
      }
      if (c.site_id && c.status) {
        // Keep best status if multiple connections per site
        const prev = siteConnStatus.get(c.site_id);
        if (!prev || c.status === "connected") {
          siteConnStatus.set(c.site_id, c.status);
        }
      }
      if (c.site_id && c.last_successful_sync_at) {
        siteSyncAt.set(c.site_id, c.last_successful_sync_at);
      }
    }

    // ── 4. Revenue today — SUM(net_sales) per loc_ref, joined to site_id ───
    const locRefs = Array.from(siteToLocRef.values());

    type SalesMap = { net: number; checks: number; guests: number; date: string };
    const salesMap = new Map<string, SalesMap>();

    if (locRefs.length > 0) {
      const { data: salesRows, error: salesErr } = await db
        .from("micros_sales_daily")
        .select("loc_ref, net_sales, check_count, guest_count, business_date")
        .in("loc_ref", locRefs)
        .eq("business_date", today);
      if (salesErr) console.error("[HEAD_OFFICE_SITES] micros_sales_daily failed:", JSON.stringify(salesErr));

      for (const r of (salesRows ?? []) as any[]) {
        const sid = locRefToSite.get(r.loc_ref);
        if (!sid) continue;
        const prev = salesMap.get(sid);
        salesMap.set(sid, {
          net:    (prev?.net    ?? 0) + Number(r.net_sales   ?? 0),
          checks: (prev?.checks ?? 0) + Number(r.check_count ?? 0),
          guests: (prev?.guests ?? 0) + Number(r.guest_count ?? 0),
          date:   r.business_date,
        });
      }

      // Also try site_id column for newer rows (migration 083 backfill)
      const { data: salesRowsBySite, error: salesErrBySite } = await db
        .from("micros_sales_daily")
        .select("site_id, net_sales, check_count, guest_count, business_date")
        .in("site_id", siteIds)
        .eq("business_date", today)
        .not("site_id", "is", null);
      if (salesErrBySite) console.error("[HEAD_OFFICE_SITES] micros_sales_daily (by site_id) failed:", JSON.stringify(salesErrBySite));

      for (const r of (salesRowsBySite ?? []) as any[]) {
        const sid = r.site_id as string;
        if (!sid) continue;
        // Only use if we didn't already get data via loc_ref (to avoid double-counting)
        if (!salesMap.has(sid)) {
          const prev = salesMap.get(sid);
          salesMap.set(sid, {
            net:    (prev?.net    ?? 0) + Number(r.net_sales   ?? 0),
            checks: (prev?.checks ?? 0) + Number(r.check_count ?? 0),
            guests: (prev?.guests ?? 0) + Number(r.guest_count ?? 0),
            date:   r.business_date,
          });
        }
      }
    }

    // ── 5. Labour today — labour_daily_summary (keyed by loc_ref) ──────────
    type LabourMap = { hours: number; count: number; date: string };
    const labourMap = new Map<string, LabourMap>();

    if (locRefs.length > 0) {
      const { data: labourRows, error: lErr } = await db
        .from("labour_daily_summary")
        .select("loc_ref, total_hours, active_staff_count, business_date")
        .in("loc_ref", locRefs)
        .eq("business_date", today);
      if (lErr) console.error("[HEAD_OFFICE_SITES] labour_daily_summary failed:", JSON.stringify(lErr));

      for (const r of (labourRows ?? []) as any[]) {
        const sid = locRefToSite.get(r.loc_ref);
        if (!sid) continue;
        const prev = labourMap.get(sid);
        labourMap.set(sid, {
          hours: (prev?.hours ?? 0) + Number(r.total_hours ?? 0),
          count: (prev?.count ?? 0) + Number(r.active_staff_count ?? 0),
          date:  r.business_date,
        });
      }
    }

    // ── 6. MICROS health (v_micros_system_health) ────────────────────────────
    type MicrosMap = { status: string; age: number | null; failures24h: number };
    const microsMap = new Map<string, MicrosMap>();

    const { data: microsRows, error: microsErr } = await db
      .from("v_micros_system_health")
      .select("site_id, connection_status, data_age_minutes, failures_24h")
      .in("site_id", siteIds);
    if (microsErr) console.error("[HEAD_OFFICE_SITES] v_micros_system_health failed:", JSON.stringify(microsErr));

    for (const r of (microsRows ?? []) as any[]) {
      if (!r.site_id) continue;
      const prev = microsMap.get(r.site_id);
      if (!prev || r.connection_status === "connected") {
        microsMap.set(r.site_id, {
          status:      r.connection_status ?? "unknown",
          age:         r.data_age_minutes  != null ? Number(r.data_age_minutes)  : null,
          failures24h: Number(r.failures_24h ?? 0),
        });
      }
    }

    // ── 7. Compliance — pass rate + due_soon + overdue per site ─────────────
    type CompMap = { pass: number; total: number; dueSoon: number; overdue: number };
    const compMap = new Map<string, CompMap>();

    const { data: compRows, error: compErr } = await db
      .from("compliance_items")
      .select("site_id, status")
      .in("site_id", siteIds)
      .eq("is_active", true);
    if (compErr) console.error("[HEAD_OFFICE_SITES] compliance_items failed:", JSON.stringify(compErr));

    for (const r of (compRows ?? []) as any[]) {
      if (!r.site_id) continue;
      const prev = compMap.get(r.site_id) ?? { pass: 0, total: 0, dueSoon: 0, overdue: 0 };
      prev.total += 1;
      if (r.status === "compliant")                  prev.pass    += 1;
      if (r.status === "due_soon")                   prev.dueSoon += 1;
      if (r.status === "overdue")                    prev.overdue += 1;
      compMap.set(r.site_id, prev);
    }

    // ── 8. Assemble site cards ───────────────────────────────────────────────
    const rawSites: SiteCardData[] = baseRows.map((h) => {
      const sales   = salesMap.get(h.site_id);
      const labour  = labourMap.get(h.site_id);
      const micros  = microsMap.get(h.site_id);
      const comp    = compMap.get(h.site_id);

      // Prefer connection status from v_micros_system_health, fall back to
      // micros_connections.status, then integration_status from health view
      const microsStatus =
        micros?.status ??
        siteConnStatus.get(h.site_id) ??
        h.integration_status ??
        "unknown";

      const dataAgeMin = micros?.age ?? null;

      const complianceScore =
        comp && comp.total > 0
          ? Math.round((comp.pass / comp.total) * 100)
          : null;

      // Compute health score via scoring engine (not view's health column)
      const { score: healthScore, severity: healthGrade } = scoreSite({
        microsStatus,
        dataAgeMinutes:  dataAgeMin,
        failures24h:     micros?.failures24h ?? 0,
        labourHours:     labour?.hours ?? null,
        complianceScore,
      });

      return {
        siteId:             h.site_id,
        siteName:           h.store_name,
        storeCode:          h.store_code ?? null,
        revenueTodayNet:    sales?.net    ?? null,
        revenueChecks:      sales?.checks ?? null,
        guestCount:         sales?.guests ?? null,
        revenueDate:        sales?.date   ?? null,
        labourHours:        labour?.hours ?? null,
        labourTimecards:    labour?.count ?? null,
        labourDate:         labour?.date  ?? null,
        microsStatus,
        microsDataAgeMin:   dataAgeMin,
        complianceScore,
        complianceDueSoon:  comp?.dueSoon ?? null,
        complianceOverdue:  comp?.overdue ?? null,
        healthGrade,
        healthScore,
        staleMins:          h.stale_minutes ?? null,
        lastSyncAt:         h.last_sync_at  ?? null,
        isDemoData:         false,
        mirroredFrom:       null,
      } satisfies SiteCardData;
    });

    // ── 9. Sandbox mirror — inject Si Cantina metrics into sandbox site ──────
    const siCantinaCard =
      rawSites.find(
        (s) =>
          SI_CANTINA_SITE_IDS.has(s.siteId) ||
          (s.storeCode != null && SI_CANTINA_STORE_CODES.has(s.storeCode)),
      ) ?? null;

    const sites = rawSites.map((site) => applySandboxMirror(site, siCantinaCard));

    return NextResponse.json({ sites, asOf: new Date().toISOString() });
  } catch (err) {
    console.error("[HEAD_OFFICE_SITES] Unhandled error:", err);
    logger.error("GET /api/head-office/sites failed", { err });
    return NextResponse.json({ error: "Failed to load site data" }, { status: 500 });
  }
}
