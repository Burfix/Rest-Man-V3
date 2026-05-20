/**
 * lib/ops/operational-context.ts — Unified operational context resolver
 *
 * resolveOperationalContext() is the single entry point that parallel-fetches
 * all three primary operational feeds — revenue, labour, inventory — for a site,
 * and attaches a canonical DataProvenance to each.
 *
 * Pattern earned after three independent implementations:
 *   1. Labour  (app/dashboard/labour/page.tsx)
 *   2. Revenue (lib/sales/service.ts → snapshotToProvenance)
 *   3. Inventory (services/inventory/intelligence.ts → inventoryToProvenance)
 *
 * Any page that needs all three feeds should use this function rather than
 * re-implementing the fetch + provenance logic inline.
 *
 * All fetches are parallel where possible; errors are isolated per feed
 * so a single failing source never blocks the others.
 */

import { getMicrosConnectionBySiteId, getMicrosStatus } from "@/services/micros/status";
import { getStoredDailySummary } from "@/services/micros/labour/summary";
import { getCurrentSalesSnapshot, snapshotToProvenance } from "@/lib/sales/service";
import {
  getInventoryIntelligence,
  inventoryToProvenance,
  type InventoryIntelligence,
} from "@/services/inventory/intelligence";
import { buildDataProvenance } from "@/lib/types/data-provenance";
import type { DataProvenance } from "@/lib/types/data-provenance";
import type { NormalizedSalesSnapshot } from "@/lib/sales/types";
import type { LabourDashboardSummary } from "@/types/labour";
import type { MicrosConnection } from "@/types/micros";
import { todayISO } from "@/lib/utils";

// ── Contract ────────────────────────────────────────────────────────────────

export interface OperationalContext {
  /** Site this context belongs to */
  siteId: string;
  /** Organisation the site belongs to */
  orgId: string | null;
  /** MICROS location reference key (null when MICROS not connected) */
  locRef: string | null;
  /** Revenue feed */
  revenue: {
    snapshot: NormalizedSalesSnapshot;
    provenance: DataProvenance;
  };
  /** Labour feed */
  labour: {
    /** null when no MICROS connection or sync not yet run */
    summary: LabourDashboardSummary | null;
    provenance: DataProvenance;
  };
  /** Inventory feed */
  inventory: {
    /** null when no inventory configured for this site */
    intelligence: InventoryIntelligence | null;
    provenance: DataProvenance;
  };
}

// ── Private helpers ──────────────────────────────────────────────────────────

function buildLabourProvenance(
  summary: LabourDashboardSummary | null,
  conn: MicrosConnection | null,
  siteId: string,
  today: string,
): DataProvenance {
  if (!conn) {
    return buildDataProvenance({
      source: "no_connection",
      fetchedAt: null,
      siteId,
      reason: "No MICROS connection for this site",
    });
  }

  if (!summary) {
    return buildDataProvenance({
      source: "no_connection",
      fetchedAt: null,
      locRef: conn.loc_ref,
      siteId,
      reason: "No labour data synced yet",
    });
  }

  const isYesterdayFallback = summary.businessDate !== today;

  return buildDataProvenance({
    source:
      isYesterdayFallback ? "stale_fallback" :
      summary.isStale     ? "stale_fallback" :
      "live_micros",
    fetchedAt: summary.lastSyncAt,
    staleAfterMinutes: 60,
    locRef: conn.loc_ref,
    siteId,
    reason:
      isYesterdayFallback
        ? `MICROS data not yet available for today — showing ${summary.businessDate}`
        : summary.isStale
          ? "Labour sync is behind schedule"
          : undefined,
  });
}

// ── Exported helper to build labour provenance without full context ───────────

export { buildLabourProvenance };

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the full operational context for a site in a single coordinated call.
 *
 * @param siteId   - UUID of the site (from getUserContext().siteId)
 * @param orgId    - UUID of the organisation (from getUserContext().orgId), or null
 *
 * Design notes:
 * - MICROS connection is fetched first because locRef is needed for labour.
 * - All three data feeds are then fetched in parallel.
 * - Each feed fails independently; a broken inventory service never blocks revenue.
 * - process.env.MICROS_IM_ENABLED is read here (server-only context).
 */
export async function resolveOperationalContext(
  siteId: string,
  orgId: string | null,
): Promise<OperationalContext> {
  const today = todayISO();
  const imEnabled = process.env.MICROS_IM_ENABLED === "true";

  // ── 1. MICROS connection (blocking — locRef needed for labour) ───────────
  const conn = await getMicrosConnectionBySiteId(siteId).catch(() => null);
  const locRef = conn?.loc_ref ?? null;

  // ── 2. Parallel data fetch ───────────────────────────────────────────────
  const [microsResult, labourResult, inventoryResult] = await Promise.allSettled([
    getMicrosStatus(siteId),
    locRef ? getStoredDailySummary(locRef) : Promise.resolve(null),
    getInventoryIntelligence(siteId),
  ]);

  const microsStatus = microsResult.status === "fulfilled" ? microsResult.value : null;
  let labourSummary: LabourDashboardSummary | null =
    labourResult.status === "fulfilled" ? labourResult.value : null;
  const inventoryIntel: InventoryIntelligence | null =
    inventoryResult.status === "fulfilled" ? inventoryResult.value : null;

  // Labour fallback: try up to 3 prior days when today has no data
  if (locRef && (!labourSummary || (labourSummary.totalLabourHours === 0 && labourSummary.activeStaffCount === 0))) {
    for (let i = 1; i <= 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const fb = await getStoredDailySummary(locRef, d.toISOString().split("T")[0]).catch(() => null);
      if (fb && fb.totalLabourHours > 0) {
        labourSummary = fb;
        break;
      }
    }
  }

  // ── 3. Revenue snapshot (depends on microsStatus from above) ─────────────
  const salesSnapshot = await getCurrentSalesSnapshot(
    today,
    microsStatus,
    null,  // forecast — callers may layer in if needed
    null,
    null,
    siteId,
  ).catch((): NormalizedSalesSnapshot => ({
    source: "forecast",
    sourceLabel: "No data",
    isLive: false,
    isStale: true,
    freshnessState: "offline",
    freshnessMinutes: null,
    lastUpdatedAt: null,
    businessDate: today,
    netSales: 0,
    grossSales: 0,
    covers: 0,
    checks: 0,
    averageSpendPerCover: 0,
    averageCheckValue: 0,
    labourCostPercent: null,
    labourCostAmount: null,
    targetSales: null,
    sameDayLastYear: null,
    targetSource: null,
    notes: [],
    data_source: "none",
  }));

  // ── 4. Canonical provenances ─────────────────────────────────────────────
  const revenueProvenance = snapshotToProvenance(salesSnapshot, siteId, locRef);
  const labourProvenance  = buildLabourProvenance(labourSummary, conn, siteId, today);
  const invProvenance     = inventoryToProvenance(inventoryIntel, siteId, imEnabled);

  return {
    siteId,
    orgId,
    locRef,
    revenue: {
      snapshot: salesSnapshot,
      provenance: revenueProvenance,
    },
    labour: {
      summary: labourSummary,
      provenance: labourProvenance,
    },
    inventory: {
      intelligence: inventoryIntel,
      provenance: invProvenance,
    },
  };
}
